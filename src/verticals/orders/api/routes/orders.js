import { Router } from 'express';
import { openDb } from '../db.js';

const db = openDb();
const router = Router();

// GET /api/orders/:id — pedido con sus items.
router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'pedido no encontrado' });
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json(order);
});

// POST /api/orders — { customer, phone, notes?, items: [{id|product_id, qty}] }.
// El total se calcula server-side con los precios reales de products;
// items con producto inexistente o qty inválida → 400.
router.post('/', (req, res) => {
  const { customer, phone, notes = '', items } = req.body ?? {};
  if (!customer?.trim() || !phone?.trim() || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'customer, phone e items (no vacío) son requeridos' });
  }

  const productById = db.prepare('SELECT id, name, price FROM products WHERE id = ?');
  const lines = [];
  for (const item of items) {
    const product = productById.get(item.product_id ?? item.id);
    const qty = Number(item.qty);
    if (!product || !Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ error: `item inválido: ${JSON.stringify(item)}` });
    }
    lines.push({ product_id: product.id, name: product.name, qty, price: product.price });
  }
  const total = lines.reduce((acc, l) => acc + l.price * l.qty, 0);

  const insertOrder = db.prepare(
    'INSERT INTO orders (customer, phone, notes, total) VALUES (?, ?, ?, ?)',
  );
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, name, qty, price) VALUES (?, ?, ?, ?, ?)',
  );
  const order = db.transaction(() => {
    const { lastInsertRowid } = insertOrder.run(customer.trim(), phone.trim(), notes, total);
    for (const l of lines) insertItem.run(lastInsertRowid, l.product_id, l.name, l.qty, l.price);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(lastInsertRowid);
  })();

  order.items = lines;
  res.status(201).json(order);
});

export default router;
