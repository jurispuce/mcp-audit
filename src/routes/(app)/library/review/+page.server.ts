import { latestAuthorship } from '#lib/domain/history.ts';
import { requirementTree, type TreeNode } from '#lib/domain/library.ts';
import {
	acceptAllInSource,
	acceptRequirement,
	editRequirement,
	lastConfirmed,
	listLibraryProposals,
	publishSource,
	rejectRequirement,
	rejectSource
} from '#lib/domain/library-review.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

function flatten(nodes: TreeNode[], depth = 0): (TreeNode & { depth: number; parentRef: string | null })[] {
	return nodes.flatMap((n) => [
		{ ...n, depth, parentRef: null as string | null },
		...flatten(n.children, depth + 1).map((c) => (c.depth === depth + 1 ? { ...c, parentRef: n.refCode } : c))
	]);
}

export const load: PageServerLoad = () => {
	const app = appDatabase();
	const p = listLibraryProposals(app);
	return {
		imports: p.sources.map((s) => ({
			...s,
			by: latestAuthorship(app, 'source', s.id)?.by ?? null,
			rows: flatten(requirementTree(app, s.id)).map(({ children: _c, ...r }) => r)
		})),
		changes: p.changes.map((c) => ({
			source: c.source,
			requirements: c.requirements.map((r) => ({ ...r, before: lastConfirmed(app, r.id) }))
		})),
		mappings: p.mappings,
		total: p.total
	};
};

const ok = (success: string) => ({ success });

export const actions: Actions = {
	accept: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id'));
		try {
			const r = acceptRequirement(appDatabase(), uiActor(locals), id);
			return ok(`${r.refCode} accepted.`);
		} catch (e) {
			return formFailure(e);
		}
	},
	reject: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id'));
		try {
			rejectRequirement(appDatabase(), uiActor(locals), id);
			return ok('Proposal rejected.');
		} catch (e) {
			return formFailure(e);
		}
	},
	edit: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const values = formValues(data, ['ref_code', 'title', 'text', 'parent']);
		try {
			const r = editRequirement(appDatabase(), uiActor(locals), id, Number(data.get('base_version')), values);
			return ok(`${r.refCode} saved. It is still proposed until you accept it.`);
		} catch (e) {
			return formFailure(e, { ...values, id, action: 'edit' });
		}
	},
	acceptAll: async ({ request, locals }) => {
		const id = String((await request.formData()).get('source'));
		try {
			const n = acceptAllInSource(appDatabase(), uiActor(locals), id);
			return ok(`${n} ${n === 1 ? 'change' : 'changes'} accepted.`);
		} catch (e) {
			return formFailure(e);
		}
	},
	publish: async ({ request, locals }) => {
		const id = String((await request.formData()).get('source'));
		try {
			const s = publishSource(appDatabase(), uiActor(locals), id);
			return ok(`${s.title} is published with ${s.requirementCount} requirements.`);
		} catch (e) {
			return formFailure(e);
		}
	},
	rejectSource: async ({ request, locals }) => {
		const id = String((await request.formData()).get('source'));
		try {
			rejectSource(appDatabase(), uiActor(locals), id);
			return ok('Proposed source rejected.');
		} catch (e) {
			return formFailure(e);
		}
	}
};
