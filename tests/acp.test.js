import { describe, expect, it } from 'vitest';
import { getEngine } from '../src/engines/index.js';
import { AcpClient } from '../src/tools/acp.js';

// DEVIN_BIN apunta a tests/fixtures/fake-devin.mjs (vitest.config.js)
// — responde JSON-RPC canned sin tocar el devin real.

describe('AcpClient — serialización JSON-RPC', () => {
  it('call() envía JSON por línea y resuelve con result', async () => {
    const client = new AcpClient(getEngine('devin'), process.cwd(), null);
    try {
      const res = await client.call('initialize', { protocolVersion: 1 });
      expect(res.echo).toBe('initialize');
    } finally {
      client.close();
    }
  });

  it('respuestas concurrentes se correlacionan por id', async () => {
    const client = new AcpClient(getEngine('devin'), process.cwd(), null);
    try {
      const [a, b] = await Promise.all([client.call('m1', {}), client.call('m2', {})]);
      expect(a.echo).toBe('m1');
      expect(b.echo).toBe('m2');
    } finally {
      client.close();
    }
  });

  it('error JSON-RPC → rechaza con el mensaje', async () => {
    const client = new AcpClient(getEngine('devin'), process.cwd(), null);
    try {
      await expect(client.call('fail', {})).rejects.toThrow('fake failure');
    } finally {
      client.close();
    }
  });

  it('notificaciones session/update se enrutan a onUpdate', async () => {
    const client = new AcpClient(getEngine('devin'), process.cwd(), null);
    const updates = [];
    client.onUpdate = (p) => updates.push(p);
    try {
      await client.call('session/prompt', {});
      expect(updates.length).toBe(1);
      expect(updates[0].update.sessionUpdate).toBe('agent_message_chunk');
      expect(updates[0].update.content.text).toBe('hola desde fake');
    } finally {
      client.close();
    }
  });
});
