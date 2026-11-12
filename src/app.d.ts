// See https://svelte.dev/docs/kit/types#app.d.ts
import type { SessionUser } from '#lib/domain/auth.ts';

declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
		}
		interface Locals {
			/** The signed-in user, or null on public pages. */
			user: SessionUser | null;
			/** Hash id of the current session, used to keep it when other sessions end. */
			sessionId: string | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
