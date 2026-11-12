import { json, type RequestEvent } from '@sveltejs/kit';
import { DomainError, StaleWriteError, ValidationError } from '#lib/domain/errors.ts';

/** Read a JSON body; a malformed one counts as empty. */
export async function body<T = Record<string, unknown>>(
	event: Pick<RequestEvent, 'request'>
): Promise<Partial<T>> {
	try {
		return ((await event.request.json()) ?? {}) as Partial<T>;
	} catch {
		return {};
	}
}

/** Run a domain call and answer JSON: the result, or the domain error with its status and fields. */
export function answer(run: () => unknown, status = 200): Response {
	try {
		return json(run() ?? { ok: true }, { status });
	} catch (e) {
		if (e instanceof StaleWriteError) {
			return json({ message: e.message, code: e.code, currentVersion: e.currentVersion }, { status: 409 });
		}
		if (e instanceof ValidationError)
			return json({ message: e.message, code: e.code, fields: e.fields }, { status: 400 });
		if (e instanceof DomainError) return json({ message: e.message, code: e.code }, { status: e.status });
		throw e;
	}
}
