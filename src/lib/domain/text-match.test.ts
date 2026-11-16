import { describe, expect, it } from 'vitest';
import {
	closestPassage,
	findQuote,
	headings,
	movedSection,
	sectionAt,
	uncoveredSections
} from './text-match';

const policy = `1 Purpose
This policy sets the rules for access.

3 Access control
3.1 Accounts
Users must never share their access credentials
(including passwords) with anyone.
3.2 Passwords
Users must use unique passwords for all work-related systems and accounts.

4 Personal data
Process personal data only as authorised.
`;

describe('matching quotes against a new version (#76)', () => {
	it('finds a quote ignoring whitespace, line breaks, case and typographic quotes and dashes', () => {
		const at = findQuote(
			policy,
			'users must NEVER share their access credentials (including passwords) with anyone.'
		);
		expect(at).not.toBeNull();
		expect(policy.slice(at!.start, at!.end)).toBe(
			'Users must never share their access credentials\n(including passwords) with anyone.'
		);
		expect(findQuote('He said “yes” – twice.', 'he said "yes" - twice')).not.toBeNull();
		expect(findQuote(policy, 'Users must use unique passwords for personal accounts')).toBeNull();
		expect(findQuote(policy, '   ')).toBeNull();
	});

	it('a quote shortened with an ellipsis matches its parts in order', () => {
		expect(findQuote(policy, 'Users must never share … with anyone.')).not.toBeNull();
		expect(findQuote(policy, 'with anyone ... Users must never share')).toBeNull();
	});

	it('offers the closest passage for a quote that changed, and nothing for an unrelated one', () => {
		const near = closestPassage(
			policy,
			'Users must use unique passwords for each work system and never reuse them'
		);
		expect(near?.passage).toContain('unique passwords for all work-related systems');
		expect(near!.score).toBeGreaterThan(0.4);
		expect(closestPassage(policy, 'Quarterly vendor invoices are archived offsite')).toBeNull();
	});

	it('reads numbered headings and the section a passage sits in', () => {
		expect(headings(policy).map((h) => `${h.number} ${h.title}`)).toEqual([
			'1 Purpose',
			'3 Access control',
			'3.1 Accounts',
			'3.2 Passwords',
			'4 Personal data'
		]);
		expect(sectionAt(policy, policy.indexOf('unique passwords'))).toBe('3.2');
		expect(sectionAt(policy, 0)).toBe('1');
		expect(sectionAt('No numbered headings here.', 5)).toBeNull();
	});

	it('moves a section number and keeps its detail; leaves a matching or non-numeric section alone', () => {
		expect(movedSection('3.2(1)-(3)', '4.2')).toBe('4.2(1)-(3)');
		expect(movedSection('3.2', '3.2')).toBeNull();
		expect(movedSection('3.2', '3.2.1')).toBeNull();
		expect(movedSection('3.2.1', '3.2')).toBeNull();
		expect(movedSection(null, '5')).toBe('5');
		expect(movedSection('Annex A', '7')).toBeNull();
		expect(movedSection('3.2', null)).toBeNull();
	});

	it('lists sections no requirement falls under; a parent counts as covered by its subsections', () => {
		expect(uncoveredSections(headings(policy), ['3.1', '3.2(1)', null]).map((h) => h.number)).toEqual([
			'1',
			'4'
		]);
	});
});
