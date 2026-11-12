import { error } from '@sveltejs/kit';
import { getEngagementArtifact, readFile } from '#lib/domain/artifacts.ts';
import { NotFoundError } from '#lib/domain/errors.ts';
import { loadConfig } from '#lib/server/config.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Download the stored file of a document in this engagement. */
export const GET: RequestHandler = ({ params }) => {
	const app = appDatabase();
	try {
		const a = getEngagementArtifact(app, params.e, params.id);
		if (!a.fileHash) throw new NotFoundError('Document not found');
		const bytes = readFile(loadConfig().filesDir, a.fileHash);
		const name = a.filename ?? 'document';
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': a.mimeType || 'application/octet-stream',
				'content-length': String(bytes.length),
				'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		if (e instanceof NotFoundError || (e as NodeJS.ErrnoException).code === 'ENOENT')
			error(404, { message: 'Document not found' });
		throw e;
	}
};
