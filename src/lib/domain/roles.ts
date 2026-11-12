/** App-wide role of a user: admins manage users; everyone else is an auditor. */
export const USER_ROLES = ['admin', 'auditor'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', auditor: 'Auditor' };

/**
 * Role of a user within one engagement. Modelled now, stored on EngagementMember (#35),
 * enforced later: a lead auditor runs the engagement, an auditor works on it, a reviewer reads and comments.
 */
export const ENGAGEMENT_ROLES = ['lead_auditor', 'auditor', 'reviewer'] as const;
export type EngagementRole = (typeof ENGAGEMENT_ROLES)[number];
export const ENGAGEMENT_ROLE_LABELS: Record<EngagementRole, string> = {
	lead_auditor: 'Lead auditor',
	auditor: 'Auditor',
	reviewer: 'Reviewer'
};

export function isEngagementRole(value: unknown): value is EngagementRole {
	return typeof value === 'string' && (ENGAGEMENT_ROLES as readonly string[]).includes(value);
}
