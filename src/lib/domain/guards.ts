import type { AppDatabase } from '#lib/db/client.ts';
import { ForbiddenError, NotFoundError } from './errors';
import type { Actor } from './write';

/**
 * Guard rails that are not about a single write: who may do what, and who may read what.
 * Write-level rules (proposed status, human-only columns, ai_allowed) live in write.ts.
 */

export function isHuman(actor: Actor): boolean {
	return actor.channel === 'ui' && !actor.agent;
}

/** Approving a finding, setting plan status, deleting an artifact file: people only, in the app. */
export function requireHuman(actor: Actor, action: string): void {
	if (!isHuman(actor)) throw new ForbiddenError(`${action} is done by a person in the app, never by AI.`);
}

/** AI may not act on an engagement whose ai_allowed switch is off. People always may. */
export function assertAiAllowed(engagement: { id: string; aiAllowed: boolean } | null, actor: Actor): void {
	if (engagement && !engagement.aiAllowed && !isHuman(actor)) {
		throw new ForbiddenError('AI is switched off for this engagement.');
	}
}

/** Who is asking to read: from inside an engagement (with its auditee) or from the shared library. */
export interface ReadContext {
	auditeeId?: string | null;
}

/**
 * Internal requirements belong to one auditee and never cross to another (CLAUDE.md rule 5).
 * A source with an auditee is readable only from an engagement of that same auditee.
 */
export function canReadSource(source: { auditee_id?: unknown }, ctx: ReadContext): boolean {
	const owner = source.auditee_id == null || source.auditee_id === '' ? null : String(source.auditee_id);
	return owner === null || owner === (ctx.auditeeId ?? null);
}

export function assertCanReadRequirement(app: AppDatabase, requirementId: string, ctx: ReadContext): void {
	const row = app.sqlite
		.prepare('SELECT s.auditee_id FROM requirement r JOIN source s ON s.id = r.source_id WHERE r.id = ?')
		.get(requirementId) as { auditee_id: string | null } | undefined;
	if (!row) throw new NotFoundError('Requirement not found');
	if (!canReadSource(row, ctx)) {
		// Same answer as "not found" would leak that it exists; say plainly that it belongs to another client.
		throw new ForbiddenError('This requirement belongs to another auditee and cannot be read here.');
	}
}

/**
 * Before a cross-cutting tool (comment, history, revert) touches an item, check it is readable in this
 * context. Library items that hang off an internal requirement follow that requirement's owner.
 */
export function assertItemReadable(app: AppDatabase, type: string, id: string, ctx: ReadContext): void {
	const requirementOf: Record<string, string> = {
		requirement: 'SELECT id AS r FROM requirement WHERE id = ?',
		guidance: 'SELECT requirement_id AS r FROM guidance WHERE id = ?',
		criterion: 'SELECT requirement_id AS r FROM criterion WHERE id = ?',
		requirement_link: 'SELECT from_id AS r, to_id AS r2 FROM requirement_link WHERE id = ?'
	};
	if (type === 'source') {
		const src = app.sqlite.prepare('SELECT auditee_id FROM source WHERE id = ?').get(id) as
			{ auditee_id: string | null } | undefined;
		if (src && !canReadSource(src, ctx))
			throw new ForbiddenError('This source belongs to another auditee and cannot be read here.');
		return;
	}
	const sql = requirementOf[type];
	if (!sql) return;
	const row = app.sqlite.prepare(sql).get(id) as { r: string; r2?: string } | undefined;
	if (!row) return; // the tool itself reports "not found"
	assertCanReadRequirement(app, row.r, ctx);
	if (row.r2) assertCanReadRequirement(app, row.r2, ctx);
}
