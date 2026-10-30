import { defineConfig } from '@playwright/test';
import path from 'node:path';

const root = process.cwd();
const localEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://sad_test:sad_test@127.0.0.1:5433/sad_logistica',
  TOKEN_SECRET: process.env.TOKEN_SECRET ?? 'local-e2e-test-secret-32-characters-minimum',
  NODE_ENV: 'development',
  PORT: '3100',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', timezoneId: 'America/Sao_Paulo', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npm.cmd run dev', cwd: root, url: 'http://127.0.0.1:3100/api/v1/health', reuseExistingServer: !process.env.CI, timeout: 60_000, env: localEnv },
    { command: 'npm.cmd run dev', cwd: path.join(root, 'web'), url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 60_000, env: localEnv },
  ],
});
