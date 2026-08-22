import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        // Seam 1 — DataEngine. Pure, no DOM. Fast.
        extends: true,
        test: {
          name: 'engine',
          environment: 'node',
          include: ['tests/engine/**/*.test.ts'],
        },
      },
      {
        // Seam 2 — Workspace. jsdom, scripted fake Translator.
        extends: true,
        test: {
          name: 'workspace',
          environment: 'jsdom',
          include: ['tests/workspace/**/*.test.ts?(x)'],
        },
      },
      {
        // Not a seam: the worker transport needs a real Worker.
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
