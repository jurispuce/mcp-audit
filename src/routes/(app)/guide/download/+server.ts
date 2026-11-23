import { instanceName } from '#lib/domain/instance.ts';
import { signInMethod } from '#lib/domain/sign-in-method.ts';
import { guideDocument } from '#lib/guide/standalone.ts';
import { requireUser } from '#lib/server/http.ts';
import { APP_VERSION } from '#lib/version.ts';
import type { RequestHandler } from './$types';

/** The guide as one self-contained HTML file with this instance's MCP address (#84). */
export const GET: RequestHandler = ({ url, locals }) => {
	requireUser(locals);
	return new Response(
		guideDocument({
			mcpUrl: `${url.origin}/mcp`,
			signIn: signInMethod(),
			instanceName: instanceName(),
			version: APP_VERSION
		}),
		{
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'content-disposition': 'attachment; filename="mcp-audit-guide.html"',
				'cache-control': 'no-store'
			}
		}
	);
};
