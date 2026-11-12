import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import {
	authenticateBearer,
	createPersonalToken,
	listPersonalTokens,
	mcpActor,
	resolvePersonalToken,
	revokePersonalToken
} from './auth';
import { ForbiddenError, ValidationError } from './errors';
import { createFirstAdmin, createUser, setUserActive, userDefinition } from './users';
import { updateEntity, type Actor } from './write';

let app: AppDatabase;
let admin: Actor;
let ben: Actor;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	admin = { userId: a.id, channel: 'ui' };
	const { user } = await createUser(app, admin, { name: 'Ben', email: 'ben@example.test' });
	ben = { userId: user.id, channel: 'ui' };
});
afterEach(() => app.close());

describe('personal access tokens (#18)', () => {
	it('creates a named token, returns it once and stores only a hash', () => {
		const { token, info } = createPersonalToken(app, ben, 'Claude Desktop on laptop');
		expect(token).toMatch(/^mcpa_[A-Za-z0-9_-]{43}$/);
		expect(info.prefix).toBe(token.slice(0, 11));
		const stored = JSON.stringify(app.sqlite.prepare('SELECT * FROM personal_token').all());
		expect(stored).not.toContain(token);
		expect(listPersonalTokens(app, ben.userId).map((t) => t.name)).toEqual(['Claude Desktop on laptop']);
	});

	it('requires a name and is created only in the app, never through MCP', () => {
		expect(() => createPersonalToken(app, ben, '  ')).toThrow(ValidationError);
		expect(() => createPersonalToken(app, { ...ben, channel: 'mcp', agent: 'Claude' }, 'x')).toThrow(
			ForbiddenError
		);
	});

	it('resolves a valid token to its user and records when it was used', () => {
		const { token, info } = createPersonalToken(app, ben, 'CLI');
		const now = new Date('2026-11-12T12:00:00Z');
		const hit = resolvePersonalToken(app, token, now);
		expect(hit?.user).toMatchObject({ id: ben.userId, email: 'ben@example.test' });
		expect(hit?.tokenId).toBe(info.id);
		expect(listPersonalTokens(app, ben.userId)[0]?.lastUsedAt).toEqual(now);
	});

	it('refuses unknown, malformed and revoked tokens', () => {
		const { token, info } = createPersonalToken(app, ben, 'CLI');
		expect(resolvePersonalToken(app, 'mcpa_nope')).toBeNull();
		expect(resolvePersonalToken(app, token.replace('mcpa_', 'xxxx_'))).toBeNull();
		expect(resolvePersonalToken(app, undefined)).toBeNull();
		revokePersonalToken(app, ben, info.id);
		expect(resolvePersonalToken(app, token)).toBeNull();
		expect(listPersonalTokens(app, ben.userId)[0]?.revokedAt).toBeInstanceOf(Date);
	});

	it('lets the owner or an admin revoke, nobody else', async () => {
		const { info } = createPersonalToken(app, admin, 'Admin token');
		expect(() => revokePersonalToken(app, ben, info.id)).toThrow(ForbiddenError);
		const mine = createPersonalToken(app, ben, 'Ben token');
		expect(() => revokePersonalToken(app, admin, mine.info.id)).not.toThrow();
	});

	it('stops working when its user is deactivated', () => {
		const { token } = createPersonalToken(app, ben, 'CLI');
		setUserActive(app, admin, ben.userId, 1, false);
		expect(resolvePersonalToken(app, token)).toBeNull();
	});

	it('authenticates a request with an Authorization bearer header', () => {
		const { token } = createPersonalToken(app, ben, 'CLI');
		const ok = new Request('http://audit.lan/mcp', { headers: { authorization: `Bearer ${token}` } });
		expect(authenticateBearer(app, ok)?.user.id).toBe(ben.userId);
		expect(authenticateBearer(app, new Request('http://audit.lan/mcp'))).toBeNull();
		const bad = new Request('http://audit.lan/mcp', { headers: { authorization: 'Bearer mcpa_wrong' } });
		expect(authenticateBearer(app, bad)).toBeNull();
	});

	it('writes made with a token record the token owner as user and the AI as agent', () => {
		const { token } = createPersonalToken(app, ben, 'Claude');
		const hit = resolvePersonalToken(app, token)!;
		const actor = mcpActor(hit.user, 'Claude');
		updateEntity(app, actor, userDefinition, ben.userId, 1, { name: 'Ben B' });
		const rev = app.sqlite
			.prepare('SELECT author_user, author_agent, channel FROM revision WHERE entity_id = ? AND version = 2')
			.get(ben.userId);
		expect(rev).toEqual({ author_user: ben.userId, author_agent: 'Claude', channel: 'mcp' });
	});
});
