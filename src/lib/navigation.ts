import type { IconName } from '#lib/components/icons.ts';

/** The five destinations inside an engagement, in audit order. They never change. */
export interface Destination {
	key: 'home' | 'setup' | 'plan' | 'run' | 'findings';
	label: string;
	icon: IconName;
	/** Path below /e/:e; '' is Home. */
	path: string;
	tabs: { label: string; path: string }[];
}

export const DESTINATIONS: Destination[] = [
	{ key: 'home', label: 'Home', icon: 'home', path: '', tabs: [] },
	{
		key: 'setup',
		label: 'Set-up',
		icon: 'setup',
		path: '/setup',
		tabs: [
			{ label: 'Requirements', path: '/setup/requirements' },
			{ label: 'Scopes', path: '/setup/scopes' },
			{ label: 'Auditee', path: '/setup/auditee' },
			{ label: 'Risks', path: '/setup/risks' },
			{ label: 'Documents', path: '/setup/documents' }
		]
	},
	{
		key: 'plan',
		label: 'Plan',
		icon: 'plan',
		path: '/plan',
		tabs: [
			{ label: 'Events', path: '/plan/events' },
			{ label: 'Coverage', path: '/plan/coverage' },
			{ label: 'Audit plan', path: '/plan/document' }
		]
	},
	{
		key: 'run',
		label: 'Run',
		icon: 'run',
		path: '/run',
		tabs: [
			{ label: 'Today', path: '/run/today' },
			{ label: 'All events', path: '/run/events' },
			{ label: 'Inbox', path: '/run/inbox' }
		]
	},
	{
		key: 'findings',
		label: 'Findings',
		icon: 'findings',
		path: '/findings',
		tabs: [
			{ label: 'Matrix', path: '/findings/matrix' },
			{ label: 'To approve', path: '/findings/to-approve' },
			{ label: 'Conclusions', path: '/findings/conclusions' }
		]
	}
];

/** Which destination a path inside an engagement belongs to. */
export function destinationFor(pathname: string, engagementId: string): Destination['key'] | null {
	const base = `/e/${engagementId}`;
	if (pathname === base || pathname === `${base}/`) return 'home';
	if (!pathname.startsWith(`${base}/`)) return null;
	const rest = pathname.slice(base.length);
	const hit = DESTINATIONS.find((d) => d.path && (rest === d.path || rest.startsWith(`${d.path}/`)));
	return hit?.key ?? null;
}

/** Same destination in another engagement: switching engagement keeps where you are. */
export function samePlaceIn(pathname: string, fromId: string, toId: string): string {
	const key = destinationFor(pathname, fromId);
	const dest = DESTINATIONS.find((d) => d.key === key);
	return `/e/${toId}${dest?.path ?? ''}`;
}
