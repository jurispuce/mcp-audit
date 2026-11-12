import { findingActions, findingsData } from '#lib/server/findings.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const d = findingsData(params.e);
	return { ...d, cards: d.cards.filter((c) => c.finding && c.finding.status !== 'approved') };
};
export const actions: Actions = findingActions;
