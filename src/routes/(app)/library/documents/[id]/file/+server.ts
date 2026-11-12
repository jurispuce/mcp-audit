import { error } from '@sveltejs/kit';
import { readFile } from '#lib/domain/artifacts.ts';
import { NotFoundError } from '#lib/domain/errors.ts';
import { getLibraryDocument } from '#lib/domain/library-documents.ts';
import { loadConfig } from '#lib/server/config.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Download a library document's file. */
export const GET: RequestHandler = ({ params }) => {
	try {
		const d = getLibraryDocument(appDatabase(), params.id);
		const bytes = readFile(loadConfig().filesDir, d.fileHash);
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': d.mimeType || 'application/octet-stream',
				'content-length': String(bytes.length),
				'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		if (e instanceof NotFoundError || (e as NodeJS.ErrnoException).code === 'ENOENT')
			error(404, { message: 'Document not found' });
		throw e;
	}
};
