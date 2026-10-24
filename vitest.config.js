import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
    },
  },
});
