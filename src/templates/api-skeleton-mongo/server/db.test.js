// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { seedIfEmpty } from './db.js';

const colStub = (count) => ({
  countDocuments: vi.fn(async () => count),
  insertMany: vi.fn(async (docs) => ({ insertedCount: docs.length })),
});

describe('seedIfEmpty', () => {
  it('siembra solo si la colección está vacía', async () => {
    const empty = colStub(0);
    expect(await seedIfEmpty(empty, [{ n: 1 }])).toBe(true);
    expect(empty.insertMany).toHaveBeenCalledWith([{ n: 1 }]);

    const full = colStub(3);
    expect(await seedIfEmpty(full, [{ n: 1 }])).toBe(false);
    expect(full.insertMany).not.toHaveBeenCalled();
  });

  it('no-op con docs vacíos', async () => {
    const c = colStub(0);
    expect(await seedIfEmpty(c, [])).toBe(false);
    expect(c.countDocuments).not.toHaveBeenCalled();
  });
});
