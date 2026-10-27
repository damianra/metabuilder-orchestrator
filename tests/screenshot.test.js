import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureScreenshot } from '../src/tools/screenshot.js';
import { writeReadme } from '../src/agents/finalizer.js';

let dir;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const tmp = () => (dir = mkdtempSync(join(tmpdir(), 'mb-shot-')));

describe('captureScreenshot', () => {
  it('sin index.html → ok:false sin spawnear nada', async () => {
    const d = tmp();
    let called = false;
    const r = await captureScreenshot({
      dir: d,
      outFile: join(d, 'shot.png'),
      runCmd: async () => {
        called = true;
        return { ok: true };
      },
    });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('sirve el build y pasa la URL al CLI de playwright', async () => {
    const d = tmp();
    writeFileSync(join(d, 'index.html'), '<h1>app</h1>');
    mkdirSync(join(d, 'assets'), { recursive: true });
    writeFileSync(join(d, 'assets', 'x.js'), 'console.log(1)');
    let cmd;
    const r = await captureScreenshot({
      dir: d,
      cwd: d,
      outFile: join(d, 'shot.png'),
      runCmd: async (c) => {
        cmd = c;
        // validar que el server sirve el index mientras corre el comando
        const url = c.match(/"(http:\/\/127\.0\.0\.1:\d+\/)"/)[1];
        const res = await fetch(url);
        expect(await res.text()).toContain('<h1>app</h1>');
        return { ok: true };
      },
    });
    expect(r.ok).toBe(true);
    expect(cmd).toContain('npx playwright screenshot');
    expect(cmd).toContain('--full-page');
    expect(cmd).toContain('shot.png');
  });
});

describe('writeReadme — engine + screenshot', () => {
  const state = (agent) => ({
    projectDir: tmp(),
    projectSlug: 'app-x',
    idea: 'idea x',
    scope: 'frontend',
    agent,
  });

  it('acredita el engine usado', () => {
    const s = state('opencode');
    writeReadme(s);
    const md = readFileSync(join(s.projectDir, 'README.md'), 'utf8');
    expect(md).toContain('usando OpenCode (via ACP)');
    expect(md).not.toContain('{{engine}}');
    expect(md).not.toContain('{{screenshot}}');
  });

  it('con screenshot → sección Captura con la imagen', () => {
    const s = state('devin');
    writeReadme(s, { screenshot: 'screenshot.png' });
    const md = readFileSync(join(s.projectDir, 'README.md'), 'utf8');
    expect(md).toContain('usando Devin (via ACP)');
    expect(md).toContain('![Captura de la app](screenshot.png)');
  });
});
