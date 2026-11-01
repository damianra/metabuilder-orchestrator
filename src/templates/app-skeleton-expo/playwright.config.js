const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  webServer: {
    command: 'npm run web',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
    // Metro tarda 30–90s en el primer bundle web — el default (60s)
    // da falsos negativos.
    timeout: 180_000,
  },
  use: { baseURL: 'http://localhost:8081' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
