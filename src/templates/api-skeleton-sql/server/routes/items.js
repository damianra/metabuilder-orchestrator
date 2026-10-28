import { Router } from 'express';
import { insert, q } from '../db.js';

/**
 * CRUD de muestra — GET/POST/DELETE sobre la tabla `items` (creada
 * por el schema por-driver en db.js). Demuestra las convenciones:
 * `q()` para prepared statements con `?`, `insert()` para obtener
 * el id nuevo portable, validación 400, y respuestas JSON planas.
 * Seguir este patrón para los recursos del dominio.
 */
const router = Router();

router.get('/', async (req, res) => {
  res.json(await q('SELECT * FROM items ORDER BY id DESC'));
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name requerido' });
  const id = await insert('INSERT INTO items (name) VALUES (?)', [name]);
  res.status(201).json({ id, name });
});

router.delete('/:id', async (req, res) => {
  await q('DELETE FROM items WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default router;
