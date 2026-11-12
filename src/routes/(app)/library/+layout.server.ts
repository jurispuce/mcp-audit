import { listLibraryProposals } from '#lib/domain/library-review.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({ proposalCount: listLibraryProposals(appDatabase()).total });
