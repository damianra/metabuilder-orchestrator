#!/usr/bin/env node
// Stub de `devin acp` para tests: lee JSON-RPC por línea de stdin y
// responde sin llamar a Devin real.
// - cualquier método → { result: { echo: <method> } }
// - 'fail' → error JSON-RPC (para probar rechazo de call())
// - 'session/prompt' → antes del result emite una notificación
//   session/update (para probar routing de updates)
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return;

  if (msg.method === 'session/prompt') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'fake-session',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'hola desde fake' },
          },
        },
      }) + '\n',
    );
  }

  const reply =
    msg.method === 'fail'
      ? { jsonrpc: '2.0', id: msg.id, error: { code: -1, message: 'fake failure' } }
      : {
          jsonrpc: '2.0',
          id: msg.id,
          // pid: los tests del pool verifican que llamadas sucesivas
          // comparten el mismo proceso stub.
          result: { echo: msg.method, sessionId: 'fake-session', pid: process.pid },
        };
  process.stdout.write(JSON.stringify(reply) + '\n');
});
