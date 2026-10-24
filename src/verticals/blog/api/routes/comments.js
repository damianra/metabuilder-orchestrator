import { Router } from 'express';
import { openDb } from '../db.js';

const db = openDb();
const router = Router();

// GET /api/comments?post_id=<n> — comentarios aprobados del post.
router.get('/', (req, res) => {
  if (!req.query.post_id) return res.status(400).json({ error: 'post_id requerido' });
  res.json(
    db
      .prepare(
        "SELECT id, author, body, created_at FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at",
      )
      .all(Number(req.query.post_id)),
  );
});

// POST /api/comments — { post_id, author, body } → 201, queda
// 'pending' de moderación (no aparece en GET hasta aprobarse).
router.post('/', (req, res) => {
  const { post_id, author, body } = req.body ?? {};
  if (!Number.isInteger(Number(post_id)) || !author?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'post_id, author y body son requeridos' });
  }
  const post = db.prepare("SELECT id FROM posts WHERE id = ? AND status = 'published'").get(post_id);
  if (!post) return res.status(404).json({ error: 'post no encontrado' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO comments (post_id, author, body) VALUES (?, ?, ?)')
    .run(post.id, author.trim(), body.trim());
  res
    .status(201)
    .json(db.prepare('SELECT * FROM comments WHERE id = ?').get(lastInsertRowid));
});

export default router;
