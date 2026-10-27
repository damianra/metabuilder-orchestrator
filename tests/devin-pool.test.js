import { describe, expect, it } from 'vitest';
import { acpPoolStats, runAgentPrompt } from '../src/tools/acp.js';

// DEVIN_BIN → fake-devin.mjs, DEVIN_CREDENTIALS_PATH → credentials.toml
// fake, DEVIN_SLOTS_DIR → tmpdir aislado (vitest.config.js): los tests
// no compiten por el slot real del semáforo.

const promptOpts = { prompt: 'hola', cwd: process.cwd(), timeoutMs: 10_000 };

describe('pool de procesos devin acp', () => {
  it('prompts sucesivos reusan el mismo proceso (handshake una sola vez)', async () => {
    const r1 = await runAgentPrompt(promptOpts);
    expect(r1.ok).toBe(true);
    expect(r1.reused).toBe(false);
    const pid1 = acpPoolStats().pid;
    expect(pid1).toBeGreaterThan(0);

    const r2 = await runAgentPrompt(promptOpts);
    expect(r2.ok).toBe(true);
    expect(r2.reused).toBe(true);
    expect(acpPoolStats().pid).toBe(pid1);
  });

  it('cada prompt abre una sesión ACP nueva aunque el proceso se reuse', async () => {
    // El stub devuelve sessionId en cada respuesta — que la llamada
    // llegue a session/prompt y responda ok implica que session/new se
    // ejecutó de nuevo sobre el proceso tibio.
    const r = await runAgentPrompt(promptOpts);
    expect(r.ok).toBe(true);
    expect(r.sessionId).toBe('fake-session');
    expect(r.reused).toBe(true);
  });

  it('si el proceso del pool muere, el próximo prompt respawnea', async () => {
    const pid1 = acpPoolStats().pid;
    expect(pid1).toBeGreaterThan(0);
    process.kill(pid1, 'SIGKILL');

    // El 'exit' tarda un tick en propagarse al flag isAlive.
    await new Promise((r) => setTimeout(r, 100));

    const r = await runAgentPrompt(promptOpts);
    expect(r.ok).toBe(true);
    expect(r.reused).toBe(false);
    expect(acpPoolStats().pid).not.toBe(pid1);
  });

  it('onUpdate sigue enrutando updates con el proceso tibio', async () => {
    const texts = [];
    const r = await runAgentPrompt({ ...promptOpts, onText: (t) => texts.push(t) });
    expect(r.ok).toBe(true);
    expect(texts.join('')).toContain('hola desde fake');
  });

  it('si session/new falla tras pool-ear, el cliente no queda ref\'d sin dueño', async () => {
    // El stub rechaza session/new cuando el cwd contiene FAIL_SESSION_NEW.
    const r = await runAgentPrompt({ prompt: 'x', cwd: '/tmp/FAIL_SESSION_NEW', timeoutMs: 10_000 });
    expect(r.ok).toBe(false);
    // El cliente pooled huérfano debe haberse descartado — si quedara
    // ref()'d retendría el event loop del proceso para siempre.
    expect(acpPoolStats().warm).toBe(false);
  });
});
