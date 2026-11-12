import { describe, expect, it } from 'vitest';
import { authorship, formatWhen } from './format';

describe('format', () => {
	it('formats times as "12 Nov 14:02", adding the year for other years', () => {
		const now = new Date(2026, 10, 12, 15, 0);
		expect(formatWhen(new Date(2026, 10, 12, 14, 2), now)).toBe('12 Nov 14:02');
		expect(formatWhen(new Date(2025, 0, 3, 9, 5), now)).toBe('3 Jan 2025 09:05');
	});

	it('reads AI authorship as "Claude on behalf of Name"', () => {
		expect(authorship('Juris', null)).toBe('Juris');
		expect(authorship('Juris', 'Claude')).toBe('Claude on behalf of Juris');
	});
});
