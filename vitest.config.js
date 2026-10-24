import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    testTimeout: 20_000,
    env: {
      // Binario stub para tests ACP — responde JSON-RPC canned sin
      // tocar el `devin` real.
      DEVIN_BIN: fileURLToPath(new URL('./tests/fixtures/fake-devin.mjs', import.meta.url)),
    },
  },
});
