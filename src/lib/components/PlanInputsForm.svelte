<script lang="ts">
	import { enhance } from '$app/forms';
	import { capacity, SCHEDULE_RULES, validatePlanInputs, type PlanInputs } from '#lib/domain/plan-inputs.ts';

	/**
	 * What the auditor decides before the plan is drafted (#79): fieldwork days, hours, about how many
	 * meetings, exceptions. Shows live how many meetings fit after the fixed parts of the schedule.
	 */
	interface Props {
		saved: PlanInputs | null;
		/** First and last day to offer when nothing is saved: the engagement's dates. */
		defaults: { from: string; to: string };
		selectedRequirements: number;
		/** Field errors and values from a failed save. */
		failed?: { fields?: Record<string, string>; values?: Record<string, string> } | null;
	}
	let { saved, defaults, selectedRequirements, failed = null }: Props = $props();

	let editing = $state(false);
	const open = $derived(!saved || editing || !!failed);
	const start = () => {
		const v = failed?.values;
		return {
			from: v?.from ?? saved?.from ?? defaults.from,
			to: v?.to ?? saved?.to ?? defaults.to,
			dayStart: v?.dayStart ?? saved?.dayStart ?? '09:00',
			dayEnd: v?.dayEnd ?? saved?.dayEnd ?? '17:00',
			lunchStart: v?.lunchStart ?? saved?.lunchStart ?? '12:00',
			lunchMinutes: v?.lunchMinutes ?? String(saved?.lunchMinutes ?? 60),
			meetings: v?.meetings ?? (saved?.meetings ? String(saved.meetings) : ''),
			exceptions: v?.exceptions ?? saved?.exceptions ?? ''
		};
	};
	let f = $state(start());
	const live = $derived.by(() => {
		try {
			return capacity(validatePlanInputs(f));
		} catch {
			return null;
		}
	});
	const savedCapacity = $derived(saved ? capacity(saved) : null);
	const R = SCHEDULE_RULES;
	const err = (k: string) => failed?.fields?.[k];
</script>

<section class="au-section au-item" aria-labelledby="plan-inputs-title" data-testid="plan-inputs">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="plan-inputs-title">Planning inputs</h2>
		{#if saved && !open}
			<button class="au-btn au-btn--small" type="button" onclick={() => ((f = start()), (editing = true))}
				>Edit planning inputs</button
			>
		{/if}
	</div>
	{#if saved && savedCapacity && !open}
		<p data-testid="plan-inputs-summary">
			{savedCapacity.days.length}
			{savedCapacity.days.length === 1 ? 'fieldwork day' : 'fieldwork days'} ({saved.from}{saved.to !==
			saved.from
				? ` to ${saved.to}`
				: ''}), {saved.dayStart}–{saved.dayEnd}{saved.lunchMinutes
				? `, lunch ${saved.lunchStart} (${saved.lunchMinutes} min)`
				: ''}. About {savedCapacity.meetingsThatFit} meetings of an hour fit{saved.meetings
				? `; aiming for about ${saved.meetings}`
				: ''}.
		</p>
		{#if saved.exceptions}<p class="au-muted">Exceptions: {saved.exceptions}</p>{/if}
	{:else}
		<p class="au-muted">
			Before drafting: how long is the fieldwork, and is there anything the plan must avoid? Draft plan fits
			the meetings into this time, with an opening meeting ({R.openingMinutes} min) at the start, a closing meeting
			({R.closingMinutes} min) at the end, a daily summary ({R.dailySummaryMinutes} min) at the end of the other
			days, lunch, and {R.notesAfterMeetingMinutes} minutes after every meeting for notes.
		</p>
		<form
			method="POST"
			action="?/planInputs"
			class="au-form"
			use:enhance={() =>
				async ({ update, result }) => {
					await update({ reset: false });
					if (result.type === 'success') editing = false;
				}}
		>
			<div class="au-row au-wrap">
				<div class="au-field" data-invalid={err('from') ? '' : undefined}>
					<label for="pi-from">First fieldwork day</label>
					<input id="pi-from" name="from" type="date" bind:value={f.from} required />
					{#if err('from')}<span class="au-field__error">{err('from')}</span>{/if}
				</div>
				<div class="au-field" data-invalid={err('to') ? '' : undefined}>
					<label for="pi-to">Last fieldwork day</label>
					<input id="pi-to" name="to" type="date" bind:value={f.to} required />
					{#if err('to')}<span class="au-field__error">{err('to')}</span>{/if}
				</div>
			</div>
			<div class="au-row au-wrap">
				<div class="au-field" data-invalid={err('dayStart') ? '' : undefined}>
					<label for="pi-start">Day starts</label>
					<input id="pi-start" name="dayStart" type="time" bind:value={f.dayStart} required />
					{#if err('dayStart')}<span class="au-field__error">{err('dayStart')}</span>{/if}
				</div>
				<div class="au-field" data-invalid={err('dayEnd') ? '' : undefined}>
					<label for="pi-end">Day ends</label>
					<input id="pi-end" name="dayEnd" type="time" bind:value={f.dayEnd} required />
					{#if err('dayEnd')}<span class="au-field__error">{err('dayEnd')}</span>{/if}
				</div>
				<div class="au-field" data-invalid={err('lunchStart') ? '' : undefined}>
					<label for="pi-lunch">Lunch starts</label>
					<input id="pi-lunch" name="lunchStart" type="time" bind:value={f.lunchStart} />
					{#if err('lunchStart')}<span class="au-field__error">{err('lunchStart')}</span>{/if}
				</div>
				<div class="au-field" data-invalid={err('lunchMinutes') ? '' : undefined}>
					<label for="pi-lunch-min">Lunch (minutes)</label>
					<input
						id="pi-lunch-min"
						name="lunchMinutes"
						type="number"
						min="0"
						max="120"
						step="5"
						bind:value={f.lunchMinutes}
					/>
					{#if err('lunchMinutes')}<span class="au-field__error">{err('lunchMinutes')}</span>{/if}
				</div>
			</div>
			<p class="au-muted" aria-live="polite" data-testid="plan-capacity">
				{#if live}
					{live.days.length}
					{live.days.length === 1 ? 'weekday' : 'weekdays'}: about {live.meetingsThatFit} meetings of an hour fit,
					for {selectedRequirements} selected requirements.
				{:else}
					Fill in the days and hours to see how many meetings fit.
				{/if}
			</p>
			<div class="au-field" data-invalid={err('meetings') ? '' : undefined}>
				<label for="pi-meetings">About how many audit meetings? (optional)</label>
				<input
					id="pi-meetings"
					name="meetings"
					type="number"
					min="1"
					max="200"
					bind:value={f.meetings}
					placeholder={live ? `up to ${live.meetingsThatFit}` : ''}
				/>
				{#if err('meetings')}<span class="au-field__error">{err('meetings')}</span>{:else}<span
						class="au-muted">Leave empty to let the plan estimate from the requirements.</span
					>{/if}
			</div>
			<div class="au-field">
				<label for="pi-exceptions">Exceptions (optional)</label>
				<textarea
					id="pi-exceptions"
					name="exceptions"
					rows="3"
					bind:value={f.exceptions}
					placeholder="Head of IT away on 3 December; the warehouse site only on Tuesday; no meetings after 15:00 on Friday"
				></textarea>
			</div>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit">Save planning inputs</button>
				{#if saved}<button class="au-btn au-btn--ghost" type="button" onclick={() => (editing = false)}
						>Cancel</button
					>{/if}
			</div>
		</form>
	{/if}
</section>
