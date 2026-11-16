import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { capacity, fieldworkDays, planningBrief, validatePlanInputs } from './plan-inputs';

// 2026-11-30 is a Monday.
const base = { from: '2026-11-30', to: '2026-12-02' };

describe('planning inputs (#79)', () => {
	it('fills defaults and checks every field', () => {
		expect(validatePlanInputs(base)).toEqual({
			...base,
			dayStart: '09:00',
			dayEnd: '17:00',
			lunchStart: '12:00',
			lunchMinutes: 60,
			meetings: null,
			exceptions: null
		});
		try {
			validatePlanInputs({
				from: '2026-12-02',
				to: '2026-11-30',
				dayStart: '9am',
				dayEnd: '10:00',
				meetings: '0'
			});
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ValidationError);
			expect(Object.keys((e as ValidationError).fields).sort()).toEqual(['dayStart', 'meetings', 'to']);
		}
		expect(() => validatePlanInputs({ ...base, dayStart: '09:00', dayEnd: '10:30' })).toThrow(
			ValidationError
		);
		expect(validatePlanInputs({ ...base, meetings: '8', exceptions: '  No Fridays  ' })).toMatchObject({
			meetings: 8,
			exceptions: 'No Fridays'
		});
	});

	it('counts weekdays only', () => {
		expect(fieldworkDays({ from: '2026-12-04', to: '2026-12-08' })).toEqual([
			'2026-12-04',
			'2026-12-07',
			'2026-12-08'
		]);
	});

	it('leaves room for the opening, closing, daily summaries, lunch and notes', () => {
		// 3 days of 7 working hours (8 h minus lunch) = 1260 min; minus opening 30 + 10, daily summaries 2 × 15,
		// closing 30 = 1160 min for meetings; 70 min per meeting with notes = 16.
		expect(capacity(validatePlanInputs(base))).toEqual({
			days: ['2026-11-30', '2026-12-01', '2026-12-02'],
			meetingMinutes: 1160,
			meetingsThatFit: 16
		});
	});

	it('briefs the model with the inputs and the schedule rules', () => {
		const brief = planningBrief(
			validatePlanInputs({ ...base, meetings: 10, exceptions: 'Head of IT away on 1 December' }),
			12
		);
		expect(brief).toContain(
			'Fieldwork: 3 days (2026-11-30, 2026-12-01, 2026-12-02), 09:00 to 17:00, lunch from 12:00 for 60 minutes.'
		);
		expect(brief).toContain(
			'About 16 meetings of 60 minutes fit in that time; 12 requirements are selected.'
		);
		expect(brief).toContain('The auditor wants about 10 audit meetings.');
		expect(brief).toContain('Exceptions to respect: Head of IT away on 1 December');
		expect(brief).toContain('An opening meeting of 30 minutes at the start of the first day');
		expect(brief).toContain('A daily summary of 15 minutes at the end of every other day');
		expect(brief).toContain('10 minutes free after every meeting for notes');
		expect(planningBrief(validatePlanInputs(base), 3)).toContain('No target number of meetings: estimate');
	});
});
