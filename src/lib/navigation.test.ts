import { describe, expect, it } from 'vitest';
import { DESTINATIONS, destinationFor, samePlaceIn } from './navigation';

describe('navigation', () => {
	it('has the five destinations in audit order', () => {
		expect(DESTINATIONS.map((d) => d.label)).toEqual(['Home', 'Set-up', 'Plan', 'Run', 'Findings']);
	});

	it('finds the destination of any engagement path', () => {
		expect(destinationFor('/e/abc', 'abc')).toBe('home');
		expect(destinationFor('/e/abc/setup/risks', 'abc')).toBe('setup');
		expect(destinationFor('/e/abc/run/events/ev1', 'abc')).toBe('run');
		expect(destinationFor('/e/abc/findings/to-approve', 'abc')).toBe('findings');
		expect(destinationFor('/e/abc/proposals', 'abc')).toBeNull();
		expect(destinationFor('/settings', 'abc')).toBeNull();
	});

	it('keeps the destination when switching engagement', () => {
		expect(samePlaceIn('/e/a/findings/conclusions', 'a', 'b')).toBe('/e/b/findings');
		expect(samePlaceIn('/e/a', 'a', 'b')).toBe('/e/b');
	});
});
