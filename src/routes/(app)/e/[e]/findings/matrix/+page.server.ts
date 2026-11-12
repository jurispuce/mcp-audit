import { findingActions, findingsData } from '#lib/server/findings.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => findingsData(params.e);
export const actions: Actions = findingActions;
