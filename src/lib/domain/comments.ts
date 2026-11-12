import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '#lib/db/client.ts';
import { NotFoundError, ValidationError } from './errors';
import { entityDefinition } from './registry';
import { assertActor, readRow, type Actor, type Channel } from './write';

/**
 * Append-only discussion on any item. There is deliberately no edit or delete function, and
 * database triggers refuse UPDATE and DELETE on the table.
 */

export interface Comment {
	id: string;
	entityType: string;
	entityId: string;
	body: string;
	authorUserId: string;
	authorName: string;
	authorAgent: string | null;
	channel: Channel;
	createdAt: Date;
}

export const MAX_COMMENT_LENGTH = 10_000;

export function addComment(
	app: AppDatabase,
	actor: Actor,
	entityType: string,
	entityId: string,
	body: string,
	now = new Date()
): Comment {
	assertActor(actor);
	const def = entityDefinition(entityType);
	if (!readRow(app, def, entityId)) throw new NotFoundError(`${entityType} ${entityId} not found`);
	const text = String(body ?? '').trim();
	if (!text) throw new ValidationError('Write something first.', { body: 'Required' });
	if (text.length > MAX_COMMENT_LENGTH) {
		throw new ValidationError(`Comments are at most ${MAX_COMMENT_LENGTH} characters.`, { body: 'Too long' });
	}
	const id = randomUUID();
	app.sqlite
		.prepare(
			`INSERT INTO comment (id, entity_type, entity_id, body, author_user, author_agent, channel, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(id, entityType, entityId, text, actor.userId, actor.agent ?? null, actor.channel, now.getTime());
	return listComments(app, entityType, entityId).find((c) => c.id === id)!;
}

/** Comments on one item, oldest first (newest last, next to the input). */
export function listComments(app: AppDatabase, entityType: string, entityId: string): Comment[] {
	const rows = app.sqlite
		.prepare(
			`SELECT c.*, u.name AS author_name FROM comment c LEFT JOIN "user" u ON u.id = c.author_user
			  WHERE c.entity_type = ? AND c.entity_id = ? ORDER BY c.created_at, c.rowid`
		)
		.all(entityType, entityId) as {
		id: string;
		entity_type: string;
		entity_id: string;
		body: string;
		author_user: string;
		author_name: string | null;
		author_agent: string | null;
		channel: Channel;
		created_at: number;
	}[];
	return rows.map((r) => ({
		id: r.id,
		entityType: r.entity_type,
		entityId: r.entity_id,
		body: r.body,
		authorUserId: r.author_user,
		authorName: r.author_name ?? r.author_user,
		authorAgent: r.author_agent,
		channel: r.channel,
		createdAt: new Date(r.created_at)
	}));
}

export function countComments(app: AppDatabase, entityType: string, entityId: string): number {
	return (
		app.sqlite
			.prepare('SELECT count(*) AS n FROM comment WHERE entity_type = ? AND entity_id = ?')
			.get(entityType, entityId) as { n: number }
	).n;
}
