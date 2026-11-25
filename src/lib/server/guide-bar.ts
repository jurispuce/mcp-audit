import type { Cookies } from '@sveltejs/kit';
import { engagementOverview } from '#lib/domain/overview.ts';
import type { AppDatabase } from '#lib/db/client.ts';
import { stepByKey, stepProgress, type GuideStep, type StepState } from '#lib/guide/content.ts';

/**
 * The guide bar (#106). Following Go from a step of the guide (`?guide=<step>` on an engagement's
 * screen) turns it on for that engagement in this browser; it stays while the person moves between
 * the engagement's screens, until they close it or choose another step. Kept in a cookie: one
 * engagement and one step, nothing else.
 */
export const GUIDE_COOKIE = 'mcpa_guide';

export interface GuideBar {
	step: GuideStep['key'];
	state: StepState;
	facts: { title: string; fact: string; done: boolean }[];
}

export function guideBar(
	app: AppDatabase,
	engagementId: string,
	url: URL,
	cookies: Cookies
): GuideBar | null {
	const asked = url.searchParams.get('guide');
	let step: GuideStep['key'] | null = null;
	if (asked && stepByKey(asked)) {
		step = stepByKey(asked)!.key;
		cookies.set(GUIDE_COOKIE, `${engagementId}:${step}`, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 30
		});
	} else {
		const [forEngagement, key] = (cookies.get(GUIDE_COOKIE) ?? '').split(':');
		if (forEngagement === engagementId && stepByKey(key)) step = stepByKey(key)!.key;
	}
	if (!step) return null;
	const phases = engagementOverview(app, engagementId).phases.map((p) => ({
		number: p.number,
		title: p.title,
		fact: p.fact,
		done: p.done
	}));
	const progress = stepProgress(phases).get(step)!;
	return { step, state: progress.state, facts: progress.facts };
}
