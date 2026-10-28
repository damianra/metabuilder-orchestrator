import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { col } from '../db.js';

/**
 * CRUD de muestra — GET/POST/DELETE sobre la colección `items`.
 * Demuestra las convenciones: `col(name)` para la colección,
 * ObjectId para el path param (400 si inválido), validación 400 y
 * respuestas JSON planas. Seguir este patrón para los recursos del
 * dominio.
 */
const router = Router();

router.get('/', async (_req, res) => {
  res.json(await (await col('items')).find().sort({ _id: -1 }).limit(100).toArray());
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name requerido' });
  const r = await (await col('items')).insertOne({ name, createdAt: new Date() });
  res.status(201).json({ id: r.insertedId, name });
});

router.delete('/:id', async (req, res) => {
  let oid;
  try {
    oid = new ObjectId(req.params.id);
  } catch {
    return res.status(400).json({ error: 'id inválido' });
  }
  await (await col('items')).deleteOne({ _id: oid });
  res.json({ ok: true });
});

export default router;
