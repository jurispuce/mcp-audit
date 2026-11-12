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
 * The auditee an item belongs to, or null for shared items (the external library, users).
 * Engagement data belongs to the engagement's auditee; library items follow their source.
 */
export function ownerAuditee(app: AppDatabase, type: string, id: string): string | null | undefined {
	const q = (sql: string) => (app.sqlite.prepare(sql).get(id) as { a: string | null } | undefined)?.a;
	const viaRequirement = (col: string, table: string) =>
		q(
			`SELECT s.auditee_id AS a FROM ${table} t JOIN requirement r ON r.id = t.${col} JOIN source s ON s.id = r.source_id WHERE t.id = ?`
		);
	switch (type) {
		case 'source':
			return q('SELECT auditee_id AS a FROM source WHERE id = ?');
		case 'requirement':
			return q(
				'SELECT s.auditee_id AS a FROM requirement r JOIN source s ON s.id = r.source_id WHERE r.id = ?'
			);
		case 'guidance':
			return viaRequirement('requirement_id', 'guidance');
		case 'criterion':
			return q(
				`SELECT coalesce(s.auditee_id, e.auditee_id) AS a FROM criterion c JOIN requirement r ON r.id = c.requirement_id
				   JOIN source s ON s.id = r.source_id LEFT JOIN engagement e ON e.id = c.engagement_id WHERE c.id = ?`
			);
		case 'requirement_link':
			return q(
				`SELECT coalesce(sf.auditee_id, st.auditee_id) AS a FROM requirement_link l
				   JOIN requirement f ON f.id = l.from_id JOIN source sf ON sf.id = f.source_id
				   JOIN requirement t ON t.id = l.to_id JOIN source st ON st.id = t.source_id WHERE l.id = ?`
			);
		case 'auditee':
			return q('SELECT id AS a FROM auditee WHERE id = ?');
		case 'person':
			return q('SELECT auditee_id AS a FROM person WHERE id = ?');
		case 'engagement':
			return q('SELECT auditee_id AS a FROM engagement WHERE id = ?');
		case 'finding_value':
			return q(
				`SELECT e.auditee_id AS a FROM finding_value v JOIN finding_scale f ON f.id = v.finding_scale_id
				   JOIN engagement e ON e.id = f.engagement_id WHERE v.id = ?`
			);
		case 'user':
			return null;
		default: {
			const table = type.replace(/[^a-z_]/g, '');
			const hasEngagement = app.sqlite
				.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = 'engagement_id'`)
				.get(table);
			if (!hasEngagement) return null;
			return q(
				`SELECT e.auditee_id AS a FROM "${table}" t JOIN engagement e ON e.id = t.engagement_id WHERE t.id = ?`
			);
		}
	}
}

/**
 * Before the item sheet or a cross-cutting tool (comment, history, revert) touches an item, check it
 * is readable in this context: an item of one auditee is readable only from that auditee's engagement.
 */
export function assertItemReadable(app: AppDatabase, type: string, id: string, ctx: ReadContext): void {
	const owner = ownerAuditee(app, type, id);
	if (owner == null) return; // shared, or not found: the caller reports "not found"
	if (owner !== (ctx.auditeeId ?? null))
		throw new ForbiddenError('This item belongs to another auditee and cannot be read here.');
}
