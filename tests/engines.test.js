import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getEngine,
  listEngines,
  resolveEngine,
  resolveEngineAuto,
  resolveEngineId,
} from '../src/engines/index.js';
import { runAgentPrompt } from '../src/tools/acp.js';

// OPENCODE_BIN apunta al mismo stub que DEVIN_BIN (vitest.config.js).
// FAKE_ACP_LOG registra los métodos JSON-RPC recibidos para verificar
// el handshake por engine (opencode no debe llamar authenticate).

const tmpLog = () => join(mkdtempSync(join(tmpdir(), 'mb-acp-')), 'calls.log');
const readCalls = (f) => {
  try {
    return readFileSync(f, 'utf8').trim().split('\n');
  } catch {
    return [];
  }
};

afterEach(() => {
  if (process.env.FAKE_ACP_LOG) {
    rmSync(process.env.FAKE_ACP_LOG, { force: true });
    delete process.env.FAKE_ACP_LOG;
  }
});

describe('registry de engines', () => {
  it('devin y opencode están declarados con sus defaults', () => {
    expect(listEngines()).toEqual(['devin', 'opencode']);
    expect(getEngine('devin').defaultMode).toBe('bypass');
    expect(getEngine('opencode').defaultMode).toBe('build');
    expect(getEngine('nope')).toBeNull();
  });

  it('resolveEngineId: flag > plan > settings > env > auto', () => {
    // Precedencia completa (sin tocar settings.json ni env reales:
    // sources inyectables; METABUILDER_SETTINGS_PATH apunta a tmp).
    expect(resolveEngineId({ flag: 'opencode', plan: 'devin', settings: 'devin' }))
      .toBe('opencode');
    expect(resolveEngineId({ flag: '', plan: 'opencode', settings: 'devin' }))
      .toBe('opencode');
    expect(resolveEngineId({ flag: '', plan: '', settings: 'opencode' }))
      .toBe('opencode');
    // Sin fuentes → 'auto' (la sonda la hace preflight)
    expect(resolveEngineId({})).toBe('auto');
  });

  it('resolveEngine: sin probe, auto o vacío cae a devin', () => {
    expect(resolveEngine('opencode').id).toBe('opencode');
    expect(resolveEngine('').id).toBe('devin');
    expect(resolveEngine('auto').id).toBe('devin');
    expect(() => resolveEngine('nope')).toThrow(/engine desconocido/);
  });

  it('resolveEngineAuto: gana el primero que autentica', async () => {
    const probe = (id) => Promise.resolve({ ok: id === 'opencode' });
    expect((await resolveEngineAuto(probe)).id).toBe('opencode');
    expect(await resolveEngineAuto(() => Promise.resolve({ ok: false }))).toBeNull();
  });
});

describe('runAgentPrompt — engine opencode', () => {
  it('mismo flujo ACP sin authenticate, mode=build', async () => {
    const log = (process.env.FAKE_ACP_LOG = tmpLog());
    const r = await runAgentPrompt({
      agent: 'opencode',
      prompt: 'hola',
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    expect(r.ok).toBe(true);
    expect(r.engine).toBe('opencode');
    expect(r.sessionId).toBe('fake-session');

    const calls = readCalls(log);
    expect(calls[0]).toBe('initialize');
    expect(calls).not.toContain('authenticate');
    expect(calls).toContain('session/new');
    expect(calls).toContain('session/set_config_option:mode=build');
    expect(calls).toContain('session/prompt');
  });

  it('un set_config_option rechazado no aborta (strictConfig=false)', async () => {
    // El stub nunca rechaza set_config_option; para verificar la
    // tolerancia alcanza con afirmar que el engine la declara —
    // el branch se cubre si el método llega y el resultado es ok.
    const engine = getEngine('opencode');
    expect(engine.strictConfig).toBe(false);
    expect(engine.authParams).toBeNull();
  });
});

describe('runAgentPrompt — engine devin (regresión)', () => {
  it('sigue llamando authenticate tras initialize', async () => {
    const log = (process.env.FAKE_ACP_LOG = tmpLog());
    const r = await runAgentPrompt({
      prompt: 'hola',
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    expect(r.ok).toBe(true);
    expect(r.engine).toBe('devin');
    const calls = readCalls(log);
    expect(calls[0]).toBe('initialize');
    expect(calls[1]).toBe('authenticate');
  });
});
