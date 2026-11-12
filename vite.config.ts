import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter({ out: 'build', precompress: true }),
			// The cross-site form check is applied in src/hooks.server.ts instead (isCrossSiteFormPost), so
			// the OAuth token endpoint can take form posts from other servers. '*' only turns off the
			// built-in copy; forms still must post from the app's own origin.
			csrf: { trustedOrigins: ['*'] }
		})
	],
	test: {
		include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
		environment: 'node',
		pool: 'forks'
	}
});
