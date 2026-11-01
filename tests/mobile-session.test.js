import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_DIR,
  mobileIdleSweep,
  mobileStatus,
  personalize,
} from '../src/design/mobile-session.js';
import { config } from '../src/config.js';
import { cpSync, existsSync, readFileSync } from 'node:fs';

// Espejo de tests/design.test.js — la sesión mobile comparte el
// contrato del diseño web sobre un workspace Expo (mobile-work/).
describe('mobile design session', () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  const tmp = () => (dir = mkdtempSync(join(tmpdir(), 'mb-mobile-session-')));

  it('mobileStatus responde el contrato exists/messages', () => {
    const d = tmp();
    expect(mobileStatus(d)).toEqual({ exists: false, messages: [] });
    writeFileSync(join(d, 'package.json'), '{}');
    const st = mobileStatus(d);
    expect(st.exists).toBe(true);
    expect(st.messages).toEqual([]);
    expect(st.devRunning).toBe(false);
    expect(st.urls).toEqual([]);
  });

  it('MOBILE_DIR vive fuera de generated-apps (no aparece como proyecto)', () => {
    expect(MOBILE_DIR).not.toContain(config.generatedAppsDir);
    expect(MOBILE_DIR).toContain('mobile-work');
  });

  it('urls solo se reportan con el dev run vivo (dev-run.json)', () => {
    const d = tmp();
    writeFileSync(join(d, 'package.json'), '{}');
    writeFileSync(
      join(d, 'dev-run.log'),
      'Metro waiting on http://localhost:8081\n',
    );
    // Sin dev-run.json → urls vacías aunque el log tenga la URL
    expect(mobileStatus(d).urls).toEqual([]);
    // Run "running" con pid muerto → stale, urls vacías
    writeFileSync(
      join(d, 'dev-run.json'),
      JSON.stringify({ status: 'running', procs: [{ pid: 999999, alive: true }] }),
    );
    expect(mobileStatus(d).devRunning).toBe(false);
    expect(mobileStatus(d).urls).toEqual([]);
    // Pid vivo → running + urls del log
    writeFileSync(
      join(d, 'dev-run.json'),
      JSON.stringify({ status: 'running', procs: [{ pid: process.pid, alive: true }] }),
    );
    const st = mobileStatus(d);
    expect(st.devRunning).toBe(true);
    expect(st.urls).toContain('http://localhost:8081');
  });

  it('personalize re-sustituye mobile-work por el slug real (sin bundle id doblado)', () => {
    // Simula el workspace post-createMobile: placeholders del skeleton
    // ya resueltos a mobile-work/mobilework.
    const d = tmp();
    cpSync(join(config.templatesDir, 'app-skeleton-expo'), d, { recursive: true });
    for (const f of ['package.json', 'app/index.tsx']) {
      const p = join(d, f);
      writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__APP_NAME__', 'mobile-work'));
    }
    writeFileSync(
      join(d, 'app.json'),
      readFileSync(join(d, 'app.json'), 'utf8')
        .replaceAll('__APP_NAME__', 'mobile-work')
        .replaceAll('__APP_PKG__', 'mobilework'),
    );
    personalize(d, 'mi-app-movil');
    const appJson = JSON.parse(readFileSync(join(d, 'app.json'), 'utf8'));
    expect(appJson.expo.name).toBe('mi-app-movil');
    expect(appJson.expo.slug).toBe('mi-app-movil');
    expect(appJson.expo.scheme).toBe('mi-app-movil');
    // Bundle id: solo alnum, sin guiones ni prefijo duplicado
    expect(appJson.expo.android.package).toBe('com.example.miappmovil');
    expect(appJson.expo.ios.bundleIdentifier).toBe('com.example.miappmovil');
    const pkg = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('mi-app-movil');
    // Sin restos del nombre de sesión ni placeholders
    expect(readFileSync(join(d, 'app/index.tsx'), 'utf8')).not.toContain('mobile-work');
    expect(readFileSync(join(d, 'app/index.tsx'), 'utf8')).not.toContain('__APP_NAME__');
  });

  it('mobileIdleSweep frena el dev run solo cuando la actividad venció', () => {
    const stop = vi.fn(() => ({ stopped: true }));
    // Dentro del grace period → no frena
    expect(
      mobileIdleSweep({ now: 1000, lastActivity: 0, idleMs: 2000, stop }),
    ).toEqual({ parked: false });
    expect(stop).not.toHaveBeenCalled();
    // Vencido → frena
    expect(
      mobileIdleSweep({ now: 5000, lastActivity: 0, idleMs: 2000, stop }),
    ).toEqual({ parked: true });
    expect(stop).toHaveBeenCalledTimes(1);
    // idleMs <= 0 → parking deshabilitado
    expect(
      mobileIdleSweep({ now: 99999, lastActivity: 0, idleMs: 0, stop }),
    ).toEqual({ parked: false });
    // stop devuelve sin stopped → no cuenta como parked
    const noStop = vi.fn(() => ({ stopped: false }));
    expect(
      mobileIdleSweep({ now: 5000, lastActivity: 0, idleMs: 2000, stop: noStop }),
    ).toEqual({ parked: false });
  });
});
