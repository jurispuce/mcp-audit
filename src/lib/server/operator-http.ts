import type { AppDatabase } from '#lib/db/client.ts';
import { TooManyAttemptsError } from '#lib/domain/errors.ts';
import { isOperatorToken, operatorNumbers, operatorToken } from '#lib/domain/operator.ts';
import { addressKey, assertNotLocked, POLICIES, recordFailure } from '#lib/domain/throttle.ts';

const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }
	});

/**
 * The operator's numbers over HTTP (#98). The caller must hold this instance's operator token; wrong
 * tokens are counted per address and lock it out, as on /mcp. An instance without OPERATOR_TOKEN
 * answers as if the address did not exist.
 */
export function operatorStatus(
	app: AppDatabase,
	request: Request,
	address: string,
	opts: { env?: Record<string, string | undefined>; filesDir?: string } = {}
): Response {
	const env = opts.env ?? process.env;
	if (!operatorToken(env)) return answer({ message: 'Not found' }, 404);
	const throttle = addressKey('operator', address);
	try {
		assertNotLocked(app, [throttle]);
	} catch (e) {
		if (!(e instanceof TooManyAttemptsError)) throw e;
		return answer({ message: e.message, code: 'too_many_attempts' }, 429, {
			'retry-after': String(e.retryAfterSeconds)
		});
	}
	const given = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
	if (!isOperatorToken(given, env)) {
		if (request.headers.has('authorization')) recordFailure(app, throttle, POLICIES.token);
		return answer({ message: 'The operator token is missing or wrong.', code: 'unauthenticated' }, 401, {
			'www-authenticate': 'Bearer'
		});
	}
	return answer(operatorNumbers(app, { filesDir: opts.filesDir }));
}
