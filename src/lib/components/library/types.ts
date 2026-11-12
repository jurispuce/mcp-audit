import type { CriterionView, GuidanceView, LinkView, Requirement } from '#lib/domain/library.ts';

/** What the item sheet receives as `extra` for a requirement (see requirementExtra). */
export interface RequirementExtra {
	requirement: Requirement;
	parent: Requirement | null;
	guidance: GuidanceView | null;
	criteria: CriterionView[];
	links: LinkView[];
	translations: Requirement[];
}

export type { Requirement };
