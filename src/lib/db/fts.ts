import type Database from 'better-sqlite3';

/**
 * Full-text search over any text column, backed by one FTS5 table (`search_index`).
 * Each row is one field of one entity. Diacritics are folded, so "pieeja" finds "piekļuve"-style
 * Latvian text typed without accents as well as with them.
 */

export interface SearchHit {
	entityType: string;
	entityId: string;
	field: string;
	snippet: string;
	rank: number;
}

/** Replace the indexed text for one field of one entity. Empty text removes it. */
export function indexText(
	sqlite: Database.Database,
	entityType: string,
	entityId: string,
	field: string,
	text: string | null | undefined
): void {
	sqlite
		.prepare('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ? AND field = ?')
		.run(entityType, entityId, field);
	if (text && text.trim()) {
		sqlite
			.prepare('INSERT INTO search_index (entity_type, entity_id, field, content) VALUES (?, ?, ?, ?)')
			.run(entityType, entityId, field, text);
	}
}

/** Remove every indexed field of one entity. */
export function removeFromIndex(sqlite: Database.Database, entityType: string, entityId: string): void {
	sqlite
		.prepare('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?')
		.run(entityType, entityId);
}

/**
 * Turn what a person typed into a safe FTS5 query: every word becomes a quoted prefix term,
 * so punctuation such as "A.5.15" or "21(2)" never breaks the query syntax.
 */
export function toFtsQuery(input: string): string | null {
	const terms = input
		.split(/\s+/)
		.map((t) => t.replace(/"/g, '').trim())
		.filter(Boolean);
	if (terms.length === 0) return null;
	return terms.map((t) => `"${t}"*`).join(' ');
}

export function searchText(
	sqlite: Database.Database,
	input: string,
	options: { entityTypes?: string[]; limit?: number } = {}
): SearchHit[] {
	const query = toFtsQuery(input);
	if (!query) return [];
	const types = options.entityTypes ?? [];
	const typeFilter = types.length ? `AND entity_type IN (${types.map(() => '?').join(', ')})` : '';
	const rows = sqlite
		.prepare(
			`SELECT entity_type AS entityType, entity_id AS entityId, field,
			        snippet(search_index, 3, '[', ']', '…', 12) AS snippet, bm25(search_index) AS rank
			   FROM search_index
			  WHERE search_index MATCH ? ${typeFilter}
			  ORDER BY rank
			  LIMIT ?`
		)
		.all(query, ...types, options.limit ?? 50) as SearchHit[];
	return rows;
}
