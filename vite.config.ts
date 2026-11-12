import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter({ out: 'build', precompress: true }),
			// Forms post from the app's own origin; ORIGIN is set at runtime so nothing assumes localhost.
			csrf: { trustedOrigins: [] }
		})
	],
	test: {
		include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
		environment: 'node',
		pool: 'forks'
	}
});
