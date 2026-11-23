/**
 * What this instance is called: in the shell, in page titles, in emails and in the guide, so a person
 * with two instances can tell them apart. Set with INSTANCE_NAME, or by a tenant profile (#91).
 */
export const DEFAULT_INSTANCE_NAME = 'mcp-audit';

export function instanceName(env: Record<string, string | undefined> = process.env): string {
	return (env.INSTANCE_NAME ?? '').trim() || DEFAULT_INSTANCE_NAME;
}
