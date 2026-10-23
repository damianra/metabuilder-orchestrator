import { Router } from 'express';
import { openDb } from '../db.js';

const db = openDb();
const router = Router();

// GET /api/business — datos del local (nombre, tagline, dirección,
// horarios, whatsapp). Fila única id=1.
router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM business WHERE id = 1').get();
  if (!row) return res.status(404).json({ error: 'sin datos del negocio' });
  res.json(row);
});

export default router;
