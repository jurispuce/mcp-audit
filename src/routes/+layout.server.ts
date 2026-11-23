import { instanceName } from '#lib/domain/instance.ts';
import type { LayoutServerLoad } from './$types';

/** What this instance is called (#91): for the shell and for every page's title. */
export const load: LayoutServerLoad = () => ({ instance: instanceName() });
