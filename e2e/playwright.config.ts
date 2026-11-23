import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OPERATOR_TOKEN, OTHER_OPERATOR_TOKEN, tenantProfile } from './tenant-profile.mjs';

/**
 * End-to-end tests run against a real server with a fresh data directory.
 *   Locally:  npm run build && npm run e2e         (starts `node build` four times: normal,
 *             first-start, one with SIGN_IN_METHOD=passkey, and one set up from a tenant profile)
 *   In CI:    E2E_BASE_URL=http://127.0.0.1:3000 E2E_FIRST_START_URL=http://127.0.0.1:3001
 *             E2E_PASSKEY_MODE_URL=http://localhost:3003 E2E_PROFILE_URL=http://localhost:3004 npm run e2e
 *             against the Docker containers, each started with TEST_SEED_ENABLED=true.
 */
const external = process.env.E2E_BASE_URL;
const firstStart = process.env.E2E_FIRST_START_URL ?? (external ? undefined : 'http://127.0.0.1:4174');
const baseURL = external ?? 'http://127.0.0.1:4173';
/** An instance without passwords (#89, #90). Reached as localhost, where browsers allow passkeys. */
const passkeyMode = process.env.E2E_PASSKEY_MODE_URL ?? (external ? undefined : 'http://localhost:4175');

/** An instance that sets itself up from a tenant profile at its first start (#91). */
const profileUrl = process.env.E2E_PROFILE_URL ?? (external ? undefined : 'http://localhost:4176');
const profileFile = path.resolve(import.meta.dirname, '..', '.e2e', 'tenant-profile.json');
if (!external) {
	mkdirSync(path.dirname(profileFile), { recursive: true });
	writeFileSync(profileFile, JSON.stringify(tenantProfile('http://127.0.0.1:4999')));
}

/** The scripted mail server (e2e/fake-smtp.mjs): the app sends to it, tests read what arrived. */
const MAIL_ENV = {
	SMTP_HOST: '127.0.0.1',
	SMTP_PORT: '2525',
	SMTP_FROM: 'mcp-audit tests <audit@example.test>'
};

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
			testIgnore: [/first-start/, /\.phone\.spec\.ts$/, /\.passkey-mode\.spec\.ts$/, /\.profile\.spec\.ts$/]
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
			: []),
		...(passkeyMode
			? [
					{
						name: 'passkey-mode',
						use: { ...devices['Desktop Chrome'], baseURL: passkeyMode },
						testMatch: /\.passkey-mode\.spec\.ts$/
					}
				]
			: []),
		...(profileUrl
			? [
					{
						name: 'profile',
						use: { ...devices['Desktop Chrome'], baseURL: profileUrl },
						testMatch: /\.profile\.spec\.ts$/
					}
				]
			: [])
	],
	webServer: [
		// First, because the instance without passwords sends an invitation as it starts.
		// With E2E_MAIL_URL set, the mail server is already running where the app can reach it.
		...(process.env.E2E_MAIL_URL
			? []
			: [
					{
						command: 'node e2e/fake-smtp.mjs',
						cwd: path.resolve(import.meta.dirname, '..'),
						url: 'http://127.0.0.1:2526/messages',
						reuseExistingServer: true,
						timeout: 20_000,
						env: { SMTP_PORT: '2525', HTTP_PORT: '2526' }
					}
				]),
		// The scripted stand-in for a LiteLLM gateway that in-app AI tests point the app at. With
		// E2E_LLM_URL set, it is already running where the app can reach it (CI starts it for the containers).
		...(process.env.E2E_LLM_URL
			? []
			: [
					{
						command: 'node e2e/fake-llm.mjs',
						cwd: path.resolve(import.meta.dirname, '..'),
						url: 'http://127.0.0.1:4999/v1/models',
						reuseExistingServer: true,
						timeout: 20_000,
						env: { PORT: '4999' }
					}
				]),
		// Only the main instance has email set up; the first-start one shows the app without it.
		...(external
			? []
			: [
					server('main', 4173, MAIL_ENV),
					server('first-start', 4174),
					server('passkey-mode', 4175, {
						...MAIL_ENV,
						SIGN_IN_METHOD: 'passkey',
						ORIGIN: 'http://localhost:4175',
						// Invited by email at start; the seeded people come on top (e2e/helpers.ts FIRST_ADMIN).
						INITIAL_ADMIN_EMAIL: 'first@example.test',
						INITIAL_ADMIN_NAME: 'Fia First',
						OPERATOR_TOKEN: OTHER_OPERATOR_TOKEN
					}),
					// No name, sign-in method or first admin in its settings: the profile brings them.
					server('profile', 4176, {
						...MAIL_ENV,
						ORIGIN: 'http://localhost:4176',
						TENANT_PROFILE: profileFile,
						// As a tenant has it (#98): the operator asks the instance its numbers with this.
						OPERATOR_TOKEN
					})
				])
	]
});
