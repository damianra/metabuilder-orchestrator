import { Router } from 'express';
import { openDb } from '../db.js';

const db = openDb();
const router = Router();

// GET /api/posts — publicados, paginados y filtrables.
//   ?page=<n>&limit=<n>   paginación (default 1/10, máx 50)
//   ?q=<texto>           busca en title/excerpt/body
//   ?category=<slug>     filtra por slug de categoría
//   ?tag=<nombre>        filtra por tag
// Devuelve { items, total, page, limit } — items incluye category y tags.
router.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const clauses = ["p.status = 'published'"];
  const args = [];
  if (req.query.q) {
    clauses.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.body LIKE ?)');
    const like = `%${req.query.q}%`;
    args.push(like, like, like);
  }
  if (req.query.category) {
    clauses.push('c.slug = ?');
    args.push(req.query.category);
  }
  if (req.query.tag) {
    clauses.push(
      'EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id AND t.name = ?)',
    );
    args.push(req.query.tag);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const base = `FROM posts p LEFT JOIN categories c ON c.id = p.category_id ${where}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...args).n;
  const items = db
    .prepare(`SELECT p.id, p.slug, p.title, p.excerpt, p.cover_image, p.published_at, c.name AS category, c.slug AS category_slug ${base} ORDER BY p.published_at DESC, p.id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, (page - 1) * limit);
  const tags = db.prepare(
    `SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ?`,
  );
  for (const p of items) p.tags = tags.all(p.id).map((t) => t.name);
  res.json({ items, total, page, limit });
});

// GET /api/posts/:slug — post completo por slug (publicado), con tags
// y comentarios aprobados.
router.get('/:slug', (req, res) => {
  const post = db
    .prepare(
      `SELECT p.*, c.name AS category, c.slug AS category_slug FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.slug = ? AND p.status = 'published'`,
    )
    .get(req.params.slug);
  if (!post) return res.status(404).json({ error: 'post no encontrado' });
  post.tags = db
    .prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ?')
    .all(post.id)
    .map((t) => t.name);
  post.comments = db
    .prepare("SELECT id, author, body, created_at FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at")
    .all(post.id);
  res.json(post);
});

export default router;
