import { instanceInfo } from '#lib/domain/email-templates.ts';
import { signInMethod } from '#lib/domain/sign-in-method.ts';
import { guideDocument, guidePolicy } from '#lib/guide/standalone.ts';
import { APP_VERSION } from '#lib/version.ts';
import type { RequestHandler } from './$types';

/**
 * The guide as a page anyone with the link can read (#100): the five steps of an audit and how to
 * connect an assistant, with this instance's own MCP address filled in. It is linked from the first
 * admin's welcome, who has not joined yet. It shows the instance's name and address and no data.
 */
export const GET: RequestHandler = ({ url }) => {
	const instance = instanceInfo(url.origin);
	return new Response(
		guideDocument({
			mcpUrl: `${instance.origin}/mcp`,
			signIn: signInMethod(),
			instanceName: instance.name,
			version: APP_VERSION
		}),
		{
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'no-store',
				// Its own policy: the page carries its styles and one script, and loads nothing.
				'content-security-policy': guidePolicy()
			}
		}
	);
};
