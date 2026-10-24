import { Router } from 'express';
import { openDb } from '../db.js';

const db = openDb();
const router = Router();

// GET /api/tags — tags con cantidad de posts publicados.
router.get('/', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT t.*, COUNT(p.id) AS post_count FROM tags t
         LEFT JOIN post_tags pt ON pt.tag_id = t.id
         LEFT JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
         GROUP BY t.id ORDER BY t.name`,
      )
      .all(),
  );
});

export default router;
