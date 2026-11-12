import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * End-to-end tests run against a real server with a fresh data directory.
 *   Locally:  npm run build && npm run e2e         (starts `node build` twice: normal and first-start)
 *   In CI:    E2E_BASE_URL=http://127.0.0.1:3000 E2E_FIRST_START_URL=http://127.0.0.1:3001 npm run e2e
 *             against the Docker containers, each started with TEST_SEED_ENABLED=true.
 */
const external = process.env.E2E_BASE_URL;
const firstStart = process.env.E2E_FIRST_START_URL ?? (external ? undefined : 'http://127.0.0.1:4174');
const baseURL = external ?? 'http://127.0.0.1:4173';

function server(name: string, port: number, extraEnv: Record<string, string> = {}) {
	return {
		command: `node e2e/serve.mjs ${name}`,
		cwd: path.resolve(import.meta.dirname, '..'),
		url: `http://127.0.0.1:${port}/health`,
		reuseExistingServer: false,
		timeout: 60_000,
		env: { PORT: String(port), HOST: '127.0.0.1', TEST_SEED_ENABLED: 'true', ...extraEnv }
	};
}

export default defineConfig({
	testDir: './tests',
	outputDir: '../test-results',
	fullyParallel: false,
	workers: 2,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
		: 'list',
	use: { baseURL, trace: 'off', screenshot: 'only-on-failure' },
	projects: [
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'] },
			testIgnore: [/first-start/, /\.phone\.spec\.ts$/]
		},
		{ name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /\.phone\.spec\.ts$/ },
		...(firstStart
			? [
					{
						name: 'first-start',
						use: { ...devices['Desktop Chrome'], baseURL: firstStart },
						testMatch: /first-start/
					}
				]
			: [])
	],
	webServer: external ? undefined : [server('main', 4173), server('first-start', 4174)]
});
