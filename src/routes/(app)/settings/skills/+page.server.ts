import { error } from '@sveltejs/kit';
import {
	getSkill,
	isSkillSet,
	listSkills,
	resetSkill,
	saveSkill,
	skillNames,
	SKILL_SET_LABELS,
	type SkillSet
} from '#lib/domain/skills.ts';
import { isAdmin } from '#lib/domain/users.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const app = appDatabase();
	const set: SkillSet = isSkillSet(url.searchParams.get('set')) ? (url.searchParams.get('set') as SkillSet) : 'connector';
	const name = url.searchParams.get('skill');
	if (name && !skillNames().includes(name)) error(404, { message: 'No such skill.' });
	return {
		set,
		sets: Object.entries(SKILL_SET_LABELS) as [SkillSet, string][],
		skills: listSkills(app, set).map((s) => ({
			name: s.name,
			description: s.description,
			edited: s.edited,
			newerDefault: s.newerDefault
		})),
		skill: name ? getSkill(app, set, name) : null,
		canEdit: isAdmin(app, uiActor(locals)),
		mcpUrl: `${url.origin}/mcp`
	};
};

function target(url: URL): { set: SkillSet; name: string } {
	const set = url.searchParams.get('set');
	const name = url.searchParams.get('skill') ?? '';
	if (!isSkillSet(set) || !skillNames().includes(name)) error(404, { message: 'No such skill.' });
	return { set, name };
}

export const actions: Actions = {
	save: async ({ request, locals, url }) => {
		const { set, name } = target(url);
		const data = await request.formData();
		const body = String(data.get('body') ?? '');
		const base = data.get('base_version');
		try {
			const s = saveSkill(appDatabase(), uiActor(locals), set, name, body, base ? Number(base) : null);
			return { success: s.edited ? `${name} saved for everyone on this instance.` : 'Same as the default; nothing to save.' };
		} catch (e) {
			return formFailure(e, { body });
		}
	},
	reset: async ({ locals, url }) => {
		const { set, name } = target(url);
		try {
			resetSkill(appDatabase(), uiActor(locals), set, name);
			return { success: `${name} is back to the default. The edit stays in its history.` };
		} catch (e) {
			return formFailure(e);
		}
	}
};
