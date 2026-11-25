import { defineParams } from '@sveltejs/kit/params';
import { STEPS } from '#lib/guide/content.ts';

/** Route parameter matchers. */
export const params = defineParams({
	/** A step of the guide (#106): /guide/setup, /guide/rules, /guide/plan, /guide/run, /guide/conclude. */
	step: (param) => STEPS.find((s) => s.key === param)?.key
});
