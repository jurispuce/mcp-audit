-- Full-text search over any text field of any entity. Diacritics folded for Latvian text.
CREATE VIRTUAL TABLE `search_index` USING fts5(
	entity_type UNINDEXED,
	entity_id UNINDEXED,
	field UNINDEXED,
	content,
	tokenize = 'unicode61 remove_diacritics 2'
);
