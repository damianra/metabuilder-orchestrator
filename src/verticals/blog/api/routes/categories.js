import { Router } from 'express';
import { openDb } from '../db.js';

const db = openDb();
const router = Router();

// GET /api/categories — categorías con cantidad de posts publicados.
router.get('/', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT c.*, COUNT(p.id) AS post_count FROM categories c
         LEFT JOIN posts p ON p.category_id = c.id AND p.status = 'published'
         GROUP BY c.id ORDER BY c.name`,
      )
      .all(),
  );
});

export default router;
