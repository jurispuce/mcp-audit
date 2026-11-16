/** Proposal types and their names, shared by the domain and the screens (no server imports here). */

export const PROPOSAL_TYPES = [
	'role',
	'risk',
	'internal',
	'recheck',
	'event',
	'evidence',
	'link',
	'finding'
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export const PROPOSAL_LABELS: Record<ProposalType, [string, string]> = {
	role: ['role', 'roles'],
	risk: ['risk', 'risks'],
	internal: ['internal requirement', 'internal requirements'],
	recheck: ['internal requirement to review', 'internal requirements to review'],
	event: ['drafted event', 'drafted events'],
	evidence: ['planned evidence item', 'planned evidence items'],
	link: ['evidence link', 'evidence links'],
	finding: ['finding', 'findings']
};

/** The source of evidence links the app proposes itself from documents already received (#83). */
export const RECEIVED_SOURCE = 'documents already received';
