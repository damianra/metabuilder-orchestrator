// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const withServer = async (fn) => {
  const app = await createApp();
  const server = app.listen(0);
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
};

describe('api base', () => {
  it('GET /api/health responde ok', async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://localhost:${port}/api/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  it('ruta /api desconocida devuelve 404 JSON', async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://localhost:${port}/api/no-existe`);
      expect(res.status).toBe(404);
    });
  });
});
