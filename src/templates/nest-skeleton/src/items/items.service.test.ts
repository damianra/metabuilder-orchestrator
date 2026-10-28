// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ItemsService } from './items.service.js';

const repoStub = () => ({
  find: vi.fn(async () => [{ id: 1, name: 'x' }]),
  save: vi.fn(async (e) => ({ id: 1, ...e })),
  delete: vi.fn(async () => ({ affected: 1 })),
});

describe('ItemsService', () => {
  it('findAll delega al repository ordenado', async () => {
    const repo = repoStub();
    const svc = new ItemsService(repo as never);
    expect(await svc.findAll()).toEqual([{ id: 1, name: 'x' }]);
    expect(repo.find).toHaveBeenCalledWith({ order: { id: 'DESC' } });
  });

  it('create persiste y devuelve id+name', async () => {
    const svc = new ItemsService(repoStub() as never);
    expect(await svc.create('nuevo')).toEqual({ id: 1, name: 'nuevo' });
  });
});
