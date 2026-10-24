import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyApiSkeleton } from '../src/agents/preflight.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'mb-api-'));

describe('copyApiSkeleton', () => {
  it('standalone: package.partial.json → package.json, partials no se copian', () => {
    const dir = tmp();
    copyApiSkeleton(dir);

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.scripts.api).toBe('node server/index.js');
    expect(pkg.dependencies.express).toBeTruthy();
    expect(pkg.dependencies['better-sqlite3']).toBeTruthy();

    expect(existsSync(join(dir, 'server', 'app.js'))).toBe(true);
    expect(existsSync(join(dir, 'server', 'routes', 'uploads.js'))).toBe(true);
    expect(existsSync(join(dir, 'package.partial.json'))).toBe(false);
    expect(existsSync(join(dir, 'gitignore.partial'))).toBe(false);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('*.sqlite');
  });

  it('convención .env: .env.example se copia, .env va al gitignore, dotenv es dep', () => {
    const dir = tmp();
    copyApiSkeleton(dir);

    expect(existsSync(join(dir, '.env.example'))).toBe(true);
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('.env');
    expect(gi).not.toContain('.env.example');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies.dotenv).toBeTruthy();
    expect(readFileSync(join(dir, 'server', 'index.js'), 'utf8')).toContain(
      "import 'dotenv/config'",
    );
  });

  it('merge sobre app-skeleton: scripts existentes ganan, deps se suman', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'x',
        scripts: { dev: 'vite', test: 'vitest run' },
        dependencies: { react: '^18.3.1' },
        devDependencies: { vite: '^5.4.11' },
      }),
    );
    writeFileSync(join(dir, '.gitignore'), 'node_modules\ndist\n');

    copyApiSkeleton(dir);

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.scripts.dev).toBe('vite'); // existente conservado
    expect(pkg.scripts.api).toBe('node server/index.js'); // nuevo agregado
    expect(pkg.dependencies.react).toBe('^18.3.1');
    expect(pkg.dependencies.express).toBeTruthy();

    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('node_modules');
    expect(gi).toContain('server/uploads/*');
  });
});
