import type { LayoutServerLoad } from './$types';

/**
 * The engagement every screen below /e/:e works in. Until the engagement tables exist (#35, #36)
 * this is a placeholder named after the id; #36 replaces it with a lookup that 404s on unknown ids.
 */
export const load: LayoutServerLoad = ({ params }) => {
	return { engagement: { id: params.e, name: `Engagement ${params.e}` } };
};
