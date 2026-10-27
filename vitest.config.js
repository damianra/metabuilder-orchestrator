import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    testTimeout: 20_000,
    env: {
      // Binario stub para tests ACP — responde JSON-RPC canned sin
      // tocar el `devin` real. Credenciales fake para loadCredentials.
      DEVIN_BIN: fileURLToPath(new URL('./tests/fixtures/fake-devin.mjs', import.meta.url)),
      DEVIN_CREDENTIALS_PATH: fileURLToPath(
        new URL('./tests/fixtures/credentials.toml', import.meta.url),
      ),
      // El engine opencode usa el mismo stub: es JSON-RPC canned,
      // engine-agnóstico (ver FAKE_ACP_LOG en el fixture).
      OPENCODE_BIN: fileURLToPath(new URL('./tests/fixtures/fake-devin.mjs', import.meta.url)),
      // Semáforo aislado: sin esto los tests que llaman runDevinPrompt
      // compiten por el slot real ~/.metabuilder/devin-slots — se
      // bloquean durante un validate:pr o un npm start concurrente.
      DEVIN_SLOTS_DIR: join(tmpdir(), 'mb-test-devin-slots'),
    },
  },
});
