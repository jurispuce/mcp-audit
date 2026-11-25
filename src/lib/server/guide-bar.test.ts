import type { Cookies } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import '#lib/domain/entities.ts';
import { createEngagement } from '#lib/domain/engagements.ts';
import { createFirstAdmin } from '#lib/domain/users.ts';
import { GUIDE_COOKIE, guideBar } from './guide-bar';

/** #106: the guide bar's state, one engagement and one step per browser, in a cookie. */
let app: AppDatabase;
let e1: string;
let e2: string;
let jar: Map<string, { value: string; opts: Record<string, unknown> }>;
const cookies = {
	get: (name: string) => jar.get(name)?.value,
	set: (name: string, value: string, opts: Record<string, unknown>) => void jar.set(name, { value, opts }),
	delete: (name: string) => void jar.delete(name)
} as unknown as Cookies;
const at = (path: string) => new URL(`https://audit.example.test${path}`);

beforeEach(async () => {
	app = createTestDatabase();
	jar = new Map();
	const admin = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	const actor = { userId: admin.id, channel: 'ui' as const };
	e1 = createEngagement(app, actor, { auditeeName: 'Acme', name: 'One', startDate: '2026-11-01' }).id;
	e2 = createEngagement(app, actor, { auditeeName: 'Bolt', name: 'Two', startDate: '2026-11-01' }).id;
});
afterEach(() => app.close());

describe('the guide bar', () => {
	it('is off until Go from a step turns it on, for that engagement', () => {
		expect(guideBar(app, e1, at(`/e/${e1}/plan/events`), cookies)).toBeNull();
		const on = guideBar(app, e1, at(`/e/${e1}/plan/events?guide=plan`), cookies)!;
		expect(on).toMatchObject({ step: 'plan', state: expect.stringMatching(/^(todo|current|done)$/) });
		expect(on.facts.length).toBeGreaterThan(0);
		expect(jar.get(GUIDE_COOKIE)).toMatchObject({
			value: `${e1}:plan`,
			opts: { path: '/', httpOnly: true, sameSite: 'lax', secure: true }
		});
		// It stays on the engagement's other screens, from the cookie.
		expect(guideBar(app, e1, at(`/e/${e1}/findings/matrix`), cookies)?.step).toBe('plan');
		// Another engagement has none.
		expect(guideBar(app, e2, at(`/e/${e2}/plan/events`), cookies)).toBeNull();
	});

	it('switches to another step, and ignores a step that does not exist', () => {
		guideBar(app, e1, at(`/e/${e1}?guide=setup`), cookies);
		expect(guideBar(app, e1, at(`/e/${e1}/run/today?guide=run`), cookies)?.step).toBe('run');
		expect(guideBar(app, e1, at(`/e/${e1}/run/today?guide=nonsense`), cookies)?.step).toBe('run');
		jar.set(GUIDE_COOKIE, { value: `${e1}:nonsense`, opts: {} });
		expect(guideBar(app, e1, at(`/e/${e1}`), cookies)).toBeNull();
	});

	it('marks the cookie secure only over https', () => {
		guideBar(app, e1, new URL(`http://audit.lan:3000/e/${e1}?guide=setup`), cookies);
		expect(jar.get(GUIDE_COOKIE)?.opts.secure).toBe(false);
	});
});
