import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requestLogger } from '../src/templates/api-skeleton/server/log.js';

// El api-skeleton loguea "método url status ms" por request — es lo
// que hace útiles los `docker logs`/`podman logs` y el dev run local.
describe('api-skeleton requestLogger', () => {
  it('emite método, url, status y ms al terminar la respuesta', async () => {
    const app = express();
    app.use(requestLogger);
    app.get('/api/ping', (req, res) => res.json({ ok: true }));
    app.post('/api/fail', (req, res) => res.status(422).json({ error: 'x' }));

    const lines = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    const server = await new Promise((r) => {
      const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      await fetch(`${url}/api/ping?x=1`);
      await fetch(`${url}/api/fail`, { method: 'POST' });
      // finish es async — un tick para que el listener escriba
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      server.close();
      spy.mockRestore();
    }

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^GET \/api\/ping\?x=1 200 \d+ms$/);
    expect(lines[1]).toMatch(/^POST \/api\/fail 422 \d+ms$/);
  });
});
