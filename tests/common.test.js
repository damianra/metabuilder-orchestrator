import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log, readPlan, runLogPath, setQuiet, textFeed, writePlan } from '../src/agents/common.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'mb-common-'));

describe('plan checkpoint', () => {
  it('writePlan/readPlan roundtrip', () => {
    const dir = tmp();
    const plan = { projectName: 't', steps: [{ id: 1, status: 'pending' }] };
    writePlan(dir, plan);
    expect(readPlan(dir)).toEqual(plan);
  });

  it('readPlan sin plan.json → null', () => {
    expect(readPlan(tmp())).toBeNull();
  });
});

describe('helpers de log', () => {
  it('log produce {ts, node, msg}', () => {
    const entry = log('build', 'paso 1 ok');
    expect(entry.node).toBe('build');
    expect(entry.msg).toBe('paso 1 ok');
    expect(new Date(entry.ts).getTime()).not.toBeNaN();
  });

  it('runLogPath: sin runDir → undefined, con runDir → prompts/<name>.rpc.jsonl', () => {
    expect(runLogPath({ runDir: null }, 'x')).toBeUndefined();
    expect(runLogPath({ runDir: '/r' }, 'build-1')).toBe('/r/prompts/build-1.rpc.jsonl');
  });
});

describe('textFeed (feed del agente → stderr)', () => {
  const feed = (opts = {}) => {
    const writes = [];
    const f = textFeed({ out: { write: (s) => writes.push(s) }, ...opts });
    return { f, writes };
  };

  it('acumula tokens y emite por tamaño + flush final', () => {
    const { f, writes } = feed({ maxLen: 20, flushMs: 60_000 });
    f.onText('voy a crear ');
    f.onText('el componente de carrito');
    expect(writes.length).toBe(1); // > maxLen → emitió una vez
    expect(writes[0]).toContain('voy a crear el componente de carrito');
    f.onText(' cola del mensaje');
    f.flush();
    expect(writes.length).toBe(2);
    expect(writes[1]).toContain('cola del mensaje');
  });

  it('emite por ventana de tiempo aunque el buffer sea corto', async () => {
    const { f, writes } = feed({ maxLen: 10_000, flushMs: 10 });
    f.onText('hola');
    expect(writes.length).toBe(0);
    await new Promise((r) => setTimeout(r, 30));
    f.onText(' mundo');
    expect(writes.length).toBe(1); // pasó flushMs → emitió
  });

  it('colapsa whitespace y corta a 500 chars', () => {
    const { f, writes } = feed({ maxLen: 10, flushMs: 0 });
    f.onText('a\n\nb   c\n' + 'x'.repeat(600));
    expect(writes[0]).toContain('a b c');
    expect(writes[0].length).toBeLessThanOrEqual(505 + '   ▸ \n'.length);
    expect(writes[0]).toContain('…');
  });

  it('respeta quiet', () => {
    setQuiet(true);
    const { f, writes } = feed({ maxLen: 1, flushMs: 0 });
    f.onText('nada visible');
    f.flush();
    setQuiet(false);
    expect(writes).toEqual([]);
  });
});
