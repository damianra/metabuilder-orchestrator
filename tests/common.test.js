import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log, readPlan, runLogPath, writePlan } from '../src/agents/common.js';

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
