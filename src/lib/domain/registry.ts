import { NotFoundError } from './errors';
import type { EntityDefinition } from './write';

/** Every versioned entity type, so generic features (item sheet, history, revert, comments) can find it. */
const definitions = new Map<string, EntityDefinition>();

export function registerEntity(def: EntityDefinition): EntityDefinition {
	const existing = definitions.get(def.type);
	if (existing && existing !== def) throw new Error(`Entity type ${def.type} registered twice`);
	definitions.set(def.type, def);
	return def;
}

export function entityDefinition(type: string): EntityDefinition {
	const def = definitions.get(type);
	if (!def) throw new NotFoundError(`Unknown item type ${type}`);
	return def;
}

export function hasEntityType(type: string): boolean {
	return definitions.has(type);
}

export function entityTypes(): string[] {
	return [...definitions.keys()];
}
