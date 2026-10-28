import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectBackendStackId, writeDockerFiles } from '../src/tools/docker.js';
import { apiSurfaceFor, apiSurfaceKindOf } from '../src/tools/api-surface.js';
import { writeFileSync, mkdirSync } from 'node:fs';

let dir;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

const tmp = () => (dir = mkdtempSync(join(tmpdir(), 'mb-docker-')));

describe('detectBackendStackId + apiSurface por stack (v11 #3)', () => {
  const withPkg = (deps) => {
    const d = tmp();
    writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: deps }));
    return d;
  };

  it('detecta el stack backend por deps (+ .env DB_DRIVER)', () => {
    expect(detectBackendStackId(withPkg({ 'better-sqlite3': '^12' }))).toBe('express-sqlite');
    expect(detectBackendStackId(withPkg({ mongodb: '^6' }))).toBe('express-mongo');
    expect(detectBackendStackId(withPkg({ '@nestjs/core': '^10' }))).toBe('nest-typeorm');
    expect(detectBackendStackId(withPkg({ pg: '^8', mysql2: '^3' }))).toBe('express-postgres');
    const d = withPkg({ pg: '^8', mysql2: '^3' });
    writeFileSync(join(d, '.env'), 'DB_DRIVER=mysql\n');
    expect(detectBackendStackId(d)).toBe('express-mysql');
    expect(detectBackendStackId(mkdtempSync(join(tmpdir(), 'mb-none-')))).toBeNull();
  });

  it('apiSurfaceFor kind nest-controllers escanea *.controller.ts', () => {
    const d = tmp();
    mkdirSync(join(d, 'src', 'items'), { recursive: true });
    writeFileSync(
      join(d, 'src', 'items', 'items.controller.ts'),
      "@Controller('api/items')\nexport class I {\n @Get('') l() {}\n @Post('nuevo') c() {}\n}\n",
    );
    const eps = apiSurfaceFor(d, { kind: apiSurfaceKindOf('nest-typeorm') });
    expect(eps).toEqual([
      { method: 'GET', path: '/api/items/', file: 'items.controller.ts' },
      { method: 'POST', path: '/api/items/nuevo', file: 'items.controller.ts' },
    ]);
    expect(apiSurfaceKindOf('express-sqlite')).toBe('express-routes');
  });
});

describe('writeDockerFiles', () => {
  it('fullstack: deps → build → runtime slim, sirve API + dist', () => {
    const variant = writeDockerFiles(tmp(), { frontend: true, backend: true });
    expect(variant).toBe('fullstack');
    const df = readFileSync(join(dir, 'Dockerfile'), 'utf8');
    expect(df).toContain('npm run build');
    expect(df).toContain('COPY --from=build /app/dist ./dist');
    expect(df).toContain('COPY server ./server');
    expect(df).toContain('CMD ["node", "server/index.js"]');
    expect(df).not.toContain('nginx');
    expect(existsSync(join(dir, '.dockerignore'))).toBe(true);
    expect(existsSync(join(dir, 'nginx.conf'))).toBe(false);
  });

  it('backend: sin stage de frontend, expone 4000', () => {
    const variant = writeDockerFiles(tmp(), { frontend: false, backend: true });
    expect(variant).toBe('backend');
    const df = readFileSync(join(dir, 'Dockerfile'), 'utf8');
    expect(df).toContain('npm ci --omit=dev');
    expect(df).toContain('EXPOSE 4000');
    expect(df).not.toContain('npm run build');
    expect(df).not.toContain('/app/dist');
  });

  it('frontend: build → nginx con SPA fallback', () => {
    const variant = writeDockerFiles(tmp(), { frontend: true, backend: false });
    expect(variant).toBe('frontend');
    const df = readFileSync(join(dir, 'Dockerfile'), 'utf8');
    expect(df).toContain('nginx:alpine');
    expect(df).toContain('/usr/share/nginx/html');
    const nginx = readFileSync(join(dir, 'nginx.conf'), 'utf8');
    expect(nginx).toContain('try_files $uri $uri/ /index.html');
  });

  it('.dockerignore excluye secretos y artefactos del contexto', () => {
    writeDockerFiles(tmp(), { frontend: true, backend: true });
    const di = readFileSync(join(dir, '.dockerignore'), 'utf8');
    for (const entry of ['node_modules', '.env', '*.sqlite', 'plan.json', 'e2e/']) {
      expect(di).toContain(entry);
    }
  });
});

describe('outDir (vite dist vs next out)', () => {
  it('outDir=out: Dockerfile fullstack copia out/ en vez de dist/', () => {
    const variant = writeDockerFiles(tmp(), { frontend: true, backend: true, outDir: 'out' });
    expect(variant).toBe('fullstack');
    const df = readFileSync(join(dir, 'Dockerfile'), 'utf8');
    expect(df).toContain('COPY --from=build /app/out ./out');
    expect(df).not.toContain('./dist');
  });

  it('frontend-only con outDir=out también usa out/', () => {
    writeDockerFiles(tmp(), { frontend: true, backend: false, outDir: 'out' });
    const df = readFileSync(join(dir, 'Dockerfile'), 'utf8');
    expect(df).toContain('/app/out');
  });
});

describe('detectFrontend/detectOutDir/detectStackId', () => {
  it('detecta vite por vite.config.js y next por next.config.*', async () => {
    const { writeFileSync } = await import('node:fs');
    const { detectFrontend, detectOutDir, detectStackId } = await import('../src/tools/docker.js');
    const d1 = tmp();
    writeFileSync(join(d1, 'vite.config.js'), 'export default {}');
    expect(detectFrontend(d1)).toBe(true);
    expect(detectOutDir(d1)).toBe('dist');
    expect(detectStackId(d1)).toBe('vite-react');

    const d2 = mkdtempSync(join(tmpdir(), 'mb-docker-next-'));
    dir = d2;
    writeFileSync(join(d2, 'next.config.mjs'), 'export default {}');
    expect(detectFrontend(d2)).toBe(true);
    expect(detectOutDir(d2)).toBe('out');
    expect(detectStackId(d2)).toBe('nextjs');

    const d3 = mkdtempSync(join(tmpdir(), 'mb-docker-none-'));
    dir = d3;
    expect(detectFrontend(d3)).toBe(false);
    expect(detectOutDir(d3)).toBeNull();
    expect(detectStackId(d3)).toBeNull();
  });
});
