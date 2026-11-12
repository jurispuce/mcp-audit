/** Small client for the app's own JSON endpoints, used from components. */
export interface ApiResult<T> {
	ok: boolean;
	status: number;
	data: T | null;
	message: string | null;
	fields: Record<string, string>;
}

export async function api<T = unknown>(
	method: string,
	url: string,
	payload?: unknown
): Promise<ApiResult<T>> {
	const res = await fetch(url, {
		method,
		headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
		body: payload === undefined ? undefined : JSON.stringify(payload)
	});
	const data: unknown = await res.json().catch(() => null);
	const err = (data ?? {}) as { message?: string; fields?: Record<string, string> };
	return {
		ok: res.ok,
		status: res.status,
		data: res.ok ? (data as T) : null,
		message: res.ok ? null : (err.message ?? `Request failed (${res.status}).`),
		fields: res.ok ? {} : (err.fields ?? {})
	};
}
