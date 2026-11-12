import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ItemCard from './ItemCard.svelte';

/** Server output with Svelte's hydration markers removed. */
const html = (props: Record<string, unknown>) =>
	render(ItemCard, { props: props as never }).body.replace(/<!--.*?-->/g, '');

const base = {
	ref: 'A.5.15 · Head office',
	title: 'Access control',
	version: 3,
	author: 'Juris',
	at: new Date(2026, 10, 12, 14, 2)
};

describe('ItemCard', () => {
	it('shows reference line, title, badge, body and meta with author and time', () => {
		const body = html({
			...base,
			badge: { label: 'Draft', tone: 'neutral' },
			body: 'Access rules exist.',
			href: '?item=requirement:r1'
		});
		expect(body).toContain('class="au-item"');
		expect(body).toContain('A.5.15 · Head office');
		expect(body).toContain('href="?item=requirement:r1"');
		expect(body).toContain('Access rules exist.');
		expect(body).toContain('v3');
		expect(body).toMatch(/Juris(&nbsp;|\u00a0| )· 12 Nov 14:02/);
		expect(body).toContain('Draft');
	});

	it('marks AI proposals with the dashed state, a badge and "Claude on behalf of"', () => {
		const body = html({ ...base, state: 'proposed', agent: 'Claude' });
		expect(body).toContain('au-item--proposed');
		expect(body).toContain('Proposed by AI');
		expect(body).toContain('Claude on behalf of Juris');
	});

	it('shows approved items as locked', () => {
		const body = html({ ...base, state: 'locked', badge: { label: 'Conformity', tone: 'ok' } });
		expect(body).toContain('au-item--locked');
		expect(body).toContain('Approved');
		expect(body).not.toContain('Conformity');
	});
});
