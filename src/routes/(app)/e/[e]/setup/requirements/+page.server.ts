import { uploadArtifacts } from '#lib/domain/artifacts.ts';
import { ValidationError } from '#lib/domain/errors.ts';
import { removeFromScope } from '#lib/domain/scope-changes.ts';
import { keepInScope, soaCheck } from '#lib/domain/soa.ts';
import { loadConfig } from '#lib/server/config.ts';
import { listScopes } from '#lib/domain/engagements.ts';
import { listInternal } from '#lib/domain/internal.ts';
import { listSources, requirementTree, type TreeNode } from '#lib/domain/library.ts';
import { criticalityOf } from '#lib/domain/risks.ts';
import {
	CRITICALITY,
	countUnits,
	deselectRequirements,
	listSelected,
	selectRequirements,
	setCriticality,
	setScopeHandling,
	upgradePin,
	type Criticality
} from '#lib/domain/selection.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

function flatten(
	nodes: TreeNode[],
	depth = 0
): { id: string; refCode: string; title: string; depth: number }[] {
	return nodes.flatMap((n) => [
		{ id: n.id, refCode: n.refCode, title: n.title, depth },
		...flatten(n.children, depth + 1)
	]);
}

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	const crit = criticalityOf(app, params.e);
	return {
		selected: listSelected(app, params.e).map((s) => ({ ...s, crit: crit.get(s.requirementId)! })),
		sources: listSources(app).map((s) => ({ ...s, items: flatten(requirementTree(app, s.id)) })),
		units: countUnits(app, params.e),
		scopes: listScopes(app, params.e).length,
		internal: listInternal(app, params.e).filter((r) => r.status === 'confirmed'),
		soa: soaCheck(app, params.e)
	};
};

export const actions: Actions = {
	uploadSoa: async ({ request, locals, params }) => {
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || file.size === 0)
			return formFailure(new ValidationError('Choose the Statement of Applicability file.'));
		try {
			const [r] = await uploadArtifacts(
				appDatabase(),
				uiActor(locals),
				loadConfig().filesDir,
				params.e,
				[{ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }],
				{ kind: 'statement_of_applicability' }
			);
			if (r?.duplicateOf)
				return formFailure(
					new ValidationError(
						`${file.name} is already here as ${r.duplicateOf.displayName}; set its kind on Set-up, Documents.`
					)
				);
			if (!r?.artifact) throw new ValidationError(r?.error ?? 'The file could not be added.');
			return {
				success:
					r.artifact.textStatus === 'extracted'
						? `${r.artifact.displayName} added. Check the scope against it with AI.`
						: `${r.artifact.displayName} added, but its text could not be read. Upload it as PDF, Excel, Word, CSV or Markdown.`
			};
		} catch (e) {
			return formFailure(e);
		}
	},
	keepSoa: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			keepInScope(
				appDatabase(),
				uiActor(locals),
				params.e,
				String(data.get('requirement')),
				String(data.get('note') ?? '')
			);
			return { success: 'Kept in the audit scope, with your reason.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	removeSoa: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			removeFromScope(
				appDatabase(),
				uiActor(locals),
				params.e,
				[String(data.get('requirement'))],
				String(data.get('reason') ?? '')
			);
			return { success: 'Removed from the audit scope. It can be selected again below.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	select: async ({ request, locals, params }) => {
		const data = await request.formData();
		const app = appDatabase();
		let ids = data.getAll('requirement').map(String);
		const all = data.get('all_of');
		if (all) {
			const src = listSources(app).find((s) => s.id === String(all));
			ids = src ? flatten(requirementTree(app, src.id)).map((r) => r.id) : [];
		}
		if (!ids.length) return formFailure(new ValidationError('Tick at least one requirement.'));
		try {
			const r = selectRequirements(app, uiActor(locals), params.e, ids);
			return { success: `${r.selected} selected${r.already ? `, ${r.already} already selected` : ''}.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	deselect: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			deselectRequirements(appDatabase(), uiActor(locals), params.e, [String(data.get('requirement'))]);
			return { success: 'Deselected.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	handling: async ({ request, locals, params }) => {
		const data = await request.formData();
		const handling = data.get('handling') === 'per_scope' ? 'per_scope' : 'common';
		try {
			setScopeHandling(appDatabase(), uiActor(locals), params.e, [
				{ requirementId: String(data.get('requirement')), scopeHandling: handling }
			]);
			return { success: handling === 'per_scope' ? 'One finding per scope.' : 'One finding for all scopes.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	criticality: async ({ request, locals, params }) => {
		const data = await request.formData();
		const value = String(data.get('criticality') ?? '');
		const level = (CRITICALITY as readonly string[]).includes(value) ? (value as Criticality) : null;
		try {
			setCriticality(appDatabase(), uiActor(locals), params.e, String(data.get('requirement')), level);
			return { success: level ? `Criticality set to ${level}.` : 'Criticality follows the risks again.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	upgrade: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			upgradePin(appDatabase(), uiActor(locals), params.e, String(data.get('requirement')));
			return { success: 'Now using the library’s current version.' };
		} catch (e) {
			return formFailure(e);
		}
	}
};
