const sameYear = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit'
});
const otherYear = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
});

/** "12 Nov 14:02", with the year when it is not this year. */
export function formatWhen(value: Date | string | number, now = new Date()): string {
	const d = new Date(value);
	return (d.getFullYear() === now.getFullYear() ? sameYear : otherYear).format(d).replace(',', '');
}

/** "Name" or "Claude on behalf of Name". */
export function authorship(name: string, agent: string | null | undefined): string {
	return agent ? `${agent} on behalf of ${name}` : name;
}

export const CHANNEL_LABELS: Record<string, string> = { ui: 'UI', mcp: 'via MCP', ai: 'in-app AI' };
