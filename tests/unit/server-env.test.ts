import { describe, expect, it } from 'vitest';
import { prepareEnv } from '../../server-env.js';

describe('server environment', () => {
	it('treats empty optional settings as unset, so ORIGIN= from .env does not crash the server', () => {
		const env: Record<string, string | undefined> = { ORIGIN: '', BODY_SIZE_LIMIT: '  ', XFF_DEPTH: '' };
		const { useForwardedProto } = prepareEnv(env);
		expect(env.ORIGIN).toBeUndefined();
		expect(env.BODY_SIZE_LIMIT).toBeUndefined();
		expect(useForwardedProto).toBe(true);
		expect(env.PROTOCOL_HEADER).toBe('x-forwarded-proto');
	});

	it('keeps a configured ORIGIN and does not touch the protocol header then', () => {
		const env: Record<string, string | undefined> = { ORIGIN: 'https://audit.example.lan' };
		expect(prepareEnv(env).useForwardedProto).toBe(false);
		expect(env.ORIGIN).toBe('https://audit.example.lan');
		expect(env.PROTOCOL_HEADER).toBeUndefined();
	});

	it('respects an explicit PROTOCOL_HEADER', () => {
		const env: Record<string, string | undefined> = { PROTOCOL_HEADER: 'x-forwarded-scheme' };
		expect(prepareEnv(env).useForwardedProto).toBe(false);
		expect(env.PROTOCOL_HEADER).toBe('x-forwarded-scheme');
	});
});
