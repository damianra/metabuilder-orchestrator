import { Router } from 'express';
import { openDb } from '../db.js';

const db = openDb();
const router = Router();

// GET /api/products — productos con su categoría (?category=<id>
// filtra). El frontend los agrupa para el menú.
router.get('/', (req, res) => {
  const where = req.query.category ? 'WHERE p.category_id = ?' : '';
  const args = req.query.category ? [Number(req.query.category)] : [];
  res.json(
    db
      .prepare(
        `SELECT p.*, c.name AS category FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         ${where} ORDER BY c.sort_order, p.name`,
      )
      .all(...args),
  );
});

export default router;
