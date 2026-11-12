/** Errors the domain layer raises. Routes and MCP tools map them to HTTP status and messages. */

export class DomainError extends Error {
	readonly status: number = 400;
	readonly code: string = 'domain_error';
}

export class ValidationError extends DomainError {
	override readonly status = 400;
	override readonly code = 'validation';
	constructor(
		message: string,
		readonly fields: Record<string, string> = {}
	) {
		super(message);
	}
}

export class NotFoundError extends DomainError {
	override readonly status = 404;
	override readonly code = 'not_found';
}

export class ForbiddenError extends DomainError {
	override readonly status = 403;
	override readonly code = 'forbidden';
}

/** Too many failed attempts: refused until `retryAfterSeconds` have passed. */
export class TooManyAttemptsError extends DomainError {
	override readonly status = 429;
	override readonly code = 'too_many_attempts';
	constructor(
		message: string,
		readonly retryAfterSeconds: number
	) {
		super(message);
	}
}

export class UnauthenticatedError extends DomainError {
	override readonly status = 401;
	override readonly code = 'unauthenticated';
}

/**
 * A write was based on an out-of-date version: someone saved first.
 * Carries the current version and state so the caller can show it and let the user redo the change.
 */
export class StaleWriteError extends DomainError {
	override readonly status = 409;
	override readonly code = 'stale_write';
	constructor(
		readonly entityType: string,
		readonly entityId: string,
		readonly baseVersion: number,
		readonly currentVersion: number,
		readonly current: Record<string, unknown>
	) {
		super(
			`${entityType} ${entityId} was changed by someone else (now version ${currentVersion}, your change was based on version ${baseVersion}).`
		);
	}
}
