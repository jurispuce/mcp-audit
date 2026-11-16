import { error } from '@sveltejs/kit';
import JSZip from 'jszip';
import { connectorSkillFiles, skillNames } from '#lib/domain/skills.ts';
import { appDatabase } from '#lib/server/db.ts';
import { requireUser } from '#lib/server/http.ts';
import type { RequestHandler } from './$types';

/**
 * The connector skills as Agent Skills: one folder per skill with SKILL.md (as edited on this
 * instance), references and assets. `?skill=<name>` for one, without for all. Any signed-in user.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireUser(locals);
	const one = url.searchParams.get('skill');
	if (one && !skillNames().includes(one)) error(404, { message: 'No such skill.' });
	const app = appDatabase();
	const zip = new JSZip();
	for (const name of one ? [one] : skillNames())
		for (const f of connectorSkillFiles(app, name)) zip.file(f.path, f.content);
	const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
	return new Response(bytes as unknown as BodyInit, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${one ?? 'mcp-audit-skills'}.zip"`,
			'cache-control': 'no-store'
		}
	});
};
