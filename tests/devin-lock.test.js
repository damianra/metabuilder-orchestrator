import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireDevinSlot } from '../src/tools/devin-lock.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => mkdtempSync(join(tmpdir(), 'mb-slots-'));

describe('acquireDevinSlot', () => {
  it('max=1: el segundo acquire espera al release', async () => {
    const baseDir = tmp();
    const r1 = await acquireDevinSlot({ max: 1, pollMs: 10, baseDir });
    let resolved = false;
    const p2 = acquireDevinSlot({ max: 1, pollMs: 10, baseDir }).then((r) => {
      resolved = true;
      return r;
    });
    await sleep(100);
    expect(resolved).toBe(false);
    r1();
    (await p2)();
    expect(resolved).toBe(true);
  });

  it('max=2: dos acquires conviven, el tercero espera', async () => {
    const baseDir = tmp();
    const r1 = await acquireDevinSlot({ max: 2, pollMs: 10, baseDir });
    const r2 = await acquireDevinSlot({ max: 2, pollMs: 10, baseDir });
    let resolved = false;
    const p3 = acquireDevinSlot({ max: 2, pollMs: 10, baseDir }).then((r) => {
      resolved = true;
      return r;
    });
    await sleep(100);
    expect(resolved).toBe(false);
    r1();
    (await p3)();
    r2();
    expect(resolved).toBe(true);
  });

  it('recicla slot de proceso muerto (pid inexistente)', async () => {
    const baseDir = tmp();
    mkdirSync(join(baseDir, 'slot-0'));
    writeFileSync(join(baseDir, 'slot-0', 'pid'), '999999');
    const t = Date.now();
    const release = await acquireDevinSlot({ max: 1, pollMs: 10, baseDir });
    expect(Date.now() - t).toBeLessThan(1000);
    release();
  });

  it('onWait dispara solo cuando toca esperar', async () => {
    const baseDir = tmp();
    const r1 = await acquireDevinSlot({ max: 1, pollMs: 10, baseDir });
    let waited = false;
    const p = acquireDevinSlot({
      max: 1,
      pollMs: 10,
      baseDir,
      onWait: () => {
        waited = true;
      },
    });
    await sleep(50);
    expect(waited).toBe(true);
    r1();
    (await p)();
  });
});
