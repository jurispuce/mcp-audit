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
			csrf: { trustedOrigins: ['*'] },
			// What a page may load and run (#99): only the app's own files. SvelteKit adds a nonce for its
			// own start-up script, so text that came from a person or a document cannot run as script,
			// whatever it contains. Styles may be inline: the app sets a few as attributes.
			// No form-action: the OAuth consent form ends in a redirect to the connecting app's address.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'media-src': ['self', 'blob:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'manifest-src': ['self'],
					'worker-src': ['self'],
					'object-src': ['none'],
					'frame-src': ['none'],
					'base-uri': ['self'],
					'frame-ancestors': ['none']
				}
			}
		})
	],
	test: {
		include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
		environment: 'node',
		pool: 'forks'
	}
});
