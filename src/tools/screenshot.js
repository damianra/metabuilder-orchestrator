// Captura de pantalla del build de una app generada para el README:
// sirve el dir de salida (dist/ u out/) con un server estático
// in-process y dispara `npx playwright screenshot` desde el cwd de la
// app — el binario lo resuelve su propio node_modules (@playwright/test
// es devDep del skeleton y chromium se pre-calienta en preflight).
// No es una condición de éxito del pipeline: el caller la envuelve en
// warn — si playwright/chromium no está, el README va sin imagen.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { run } from './shell.js';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

const safePath = (dir, urlPath) => {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
  const p = join(dir, rel);
  return p.startsWith(dir) ? p : join(dir, 'index.html');
};

/**
 * Sirve `dir` y captura `outFile` (PNG full-page del index).
 * @returns {Promise<{ok:boolean, stderr:string}>}
 */
export async function captureScreenshot({
  dir,
  cwd = dir, // cwd para resolver npx — típicamente la raíz de la app
  outFile,
  width = 1280,
  height = 900,
  waitMs = 2000,
  timeoutMs = 60_000,
  runCmd = run,
  serverFactory = createServer,
}) {
  if (!existsSync(join(dir, 'index.html')))
    return { ok: false, stderr: `sin index.html en ${dir}` };

  const server = serverFactory((req, res) => {
    try {
      let f = safePath(dir, new URL(req.url, 'http://x').pathname);
      if (!existsSync(f) || !statSync(f).isFile()) f = join(dir, 'index.html'); // SPA fallback
      res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
      createReadStream(f).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const res = await runCmd(
      `npx playwright screenshot --full-page --viewport-size=${width},${height} --wait-for-timeout=${waitMs} "${url}" "${outFile}"`,
      { cwd, timeoutMs },
    );
    return res;
  } finally {
    server.close();
  }
}
