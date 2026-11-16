import { ValidationError } from './errors';

/**
 * What the auditor decides before a plan is drafted (#79): the fieldwork days and hours, how many
 * meetings to aim for, and exceptions. Stored on the engagement; Draft plan and the plan-builder skill
 * read it. Pure functions only: no database access here.
 */

export interface PlanInputs {
	/** First and last fieldwork day (YYYY-MM-DD). Weekends in between are not counted. */
	from: string;
	to: string;
	/** Working hours (HH:MM). */
	dayStart: string;
	dayEnd: string;
	/** Lunch break start (HH:MM) and length in minutes (0 for none). */
	lunchStart: string;
	lunchMinutes: number;
	/** About how many audit meetings the auditor wants; null lets the plan estimate. */
	meetings: number | null;
	/** Dates, people or places to avoid, and anything else the plan must respect. */
	exceptions: string | null;
}

/** The fixed parts of every audit schedule. */
export const SCHEDULE_RULES = {
	openingMinutes: 30,
	closingMinutes: 30,
	dailySummaryMinutes: 15,
	notesAfterMeetingMinutes: 10,
	typicalMeetingMinutes: 60
} as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Check and normalise the inputs; field errors name the form fields. */
export function validatePlanInputs(input: unknown): PlanInputs {
	const v = (input ?? {}) as Record<string, unknown>;
	const s = (k: string) => (v[k] == null ? '' : String(v[k]).trim());
	const fields: Record<string, string> = {};
	const from = s('from');
	const to = s('to') || from;
	if (!DATE.test(from) || Number.isNaN(Date.parse(from))) fields.from = 'Use a date such as 2026-12-01.';
	if (!DATE.test(to) || Number.isNaN(Date.parse(to))) fields.to = 'Use a date such as 2026-12-03.';
	else if (!fields.from && to < from) fields.to = 'Before the first day.';
	else if (!fields.from && (Date.parse(to) - Date.parse(from)) / 86_400_000 > 60)
		fields.to = 'At most 60 days of fieldwork.';
	const dayStart = s('dayStart') || '09:00';
	const dayEnd = s('dayEnd') || '17:00';
	const lunchStart = s('lunchStart') || '12:00';
	for (const [k, t] of [
		['dayStart', dayStart],
		['dayEnd', dayEnd],
		['lunchStart', lunchStart]
	] as const)
		if (!TIME.test(t)) fields[k] = 'Use a time such as 09:00.';
	if (!fields.dayStart && !fields.dayEnd && minutes(dayEnd) - minutes(dayStart) < 120)
		fields.dayEnd = 'At least two hours after the start.';
	const lunchMinutes = v.lunchMinutes == null || s('lunchMinutes') === '' ? 60 : Number(v.lunchMinutes);
	if (!Number.isInteger(lunchMinutes) || lunchMinutes < 0 || lunchMinutes > 120)
		fields.lunchMinutes = 'Between 0 and 120 minutes.';
	const m = s('meetings');
	const meetings = m === '' ? null : Number(m);
	if (meetings !== null && (!Number.isInteger(meetings) || meetings < 1 || meetings > 200))
		fields.meetings = 'A whole number from 1 to 200, or empty to let the plan estimate.';
	const exceptions = s('exceptions').slice(0, 2000) || null;
	if (Object.keys(fields).length) throw new ValidationError('Check the planning inputs.', fields);
	return { from, to, dayStart, dayEnd, lunchStart, lunchMinutes, meetings, exceptions };
}

/** Weekdays from `from` to `to`, inclusive. */
export function fieldworkDays(p: Pick<PlanInputs, 'from' | 'to'>): string[] {
	const out: string[] = [];
	for (let t = Date.parse(`${p.from}T00:00:00Z`); t <= Date.parse(`${p.to}T00:00:00Z`); t += 86_400_000) {
		const d = new Date(t);
		if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
	}
	return out;
}

export interface Capacity {
	days: string[];
	/** Minutes left for audit meetings after the opening, closing, daily summaries and lunch. */
	meetingMinutes: number;
	/** About how many meetings of a typical length fit, each followed by time for notes. */
	meetingsThatFit: number;
}

export function capacity(p: PlanInputs): Capacity {
	const days = fieldworkDays(p);
	const perDay = minutes(p.dayEnd) - minutes(p.dayStart) - p.lunchMinutes;
	const r = SCHEDULE_RULES;
	let total = 0;
	days.forEach((_, i) => {
		let fixed = 0;
		if (i === 0) fixed += r.openingMinutes + r.notesAfterMeetingMinutes;
		fixed += i === days.length - 1 ? r.closingMinutes : r.dailySummaryMinutes;
		total += Math.max(0, perDay - fixed);
	});
	return {
		days,
		meetingMinutes: total,
		meetingsThatFit: Math.floor(total / (r.typicalMeetingMinutes + r.notesAfterMeetingMinutes))
	};
}

/** The planning brief the model gets with Draft plan, and the plan-builder skill follows. */
export function planningBrief(p: PlanInputs, selectedRequirements: number): string {
	const c = capacity(p);
	const r = SCHEDULE_RULES;
	const lunch = p.lunchMinutes
		? `lunch from ${p.lunchStart} for ${p.lunchMinutes} minutes`
		: 'no lunch break';
	return [
		'Planning inputs the auditor set before drafting:',
		`- Fieldwork: ${c.days.length} ${c.days.length === 1 ? 'day' : 'days'} (${c.days.join(', ') || 'no weekdays in the range'}), ${p.dayStart} to ${p.dayEnd}, ${lunch}.`,
		`- About ${c.meetingsThatFit} meetings of ${r.typicalMeetingMinutes} minutes fit in that time; ${selectedRequirements} requirements are selected.`,
		p.meetings
			? `- The auditor wants about ${p.meetings} audit meetings. Plan close to that number; if the requirements cannot be covered in it, say so in your summary.`
			: '- No target number of meetings: estimate how many the requirements need, fit them into the time available, and give the number in your summary.',
		p.exceptions ? `- Exceptions to respect: ${p.exceptions}` : '- No exceptions given.',
		'Schedule rules (always):',
		`- An opening meeting of ${r.openingMinutes} minutes at the start of the first day, and a closing meeting of ${r.closingMinutes} minutes at the end of the last day (formats opening_meeting and closing_meeting, no requirements).`,
		`- A daily summary of ${r.dailySummaryMinutes} minutes at the end of every other day (format daily_summary).`,
		`- ${r.notesAfterMeetingMinutes} minutes free after every meeting for notes: the next meeting starts at least ${r.notesAfterMeetingMinutes} minutes after one ends.`,
		'- No meeting during lunch or outside working hours, and none on the excluded dates.',
		'- Give every event a date, start time and duration. If the requirements need more meetings than fit, combine related topics and say what you combined; never leave a requirement out silently.'
	].join('\n');
}
