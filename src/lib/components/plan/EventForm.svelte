<script lang="ts">
	import Field from '../Field.svelte';
	import RequirementChecklist from '../RequirementChecklist.svelte';

	/** All fields of an event. Used for adding, editing and reviewing AI drafts. */
	interface Props {
		prefix: string;
		values: Record<string, unknown>;
		fields?: Record<string, string>;
		people: { id: string; label: string }[];
		requirements: { id: string; refCode: string; title: string }[];
		showStatus?: boolean;
	}
	let { prefix, values, fields = {}, people, requirements, showStatus = false }: Props = $props();
	const FORMATS = [
		['interview', 'Interview'],
		['walkthrough', 'Walkthrough'],
		['document_review', 'Document review'],
		['technical_test', 'Technical test'],
		['site_visit', 'Site visit'],
		['other', 'Other']
	];
	const s = (k: string) => (values[k] == null ? '' : String(values[k]));
	const list = (k: string) =>
		Array.isArray(values[k]) ? (values[k] as string[]) : s(k) ? s(k).split(',') : [];
</script>

<Field
	label="Event title"
	name="title"
	id="{prefix}-title"
	required
	value={s('title')}
	error={fields.title}
	placeholder="Access and identity interview"
/>
<div class="au-row au-wrap">
	<div class="au-field">
		<label for="{prefix}-format">Format</label>
		<select id="{prefix}-format" name="format">
			{#each FORMATS as [v, l] (v)}<option value={v} selected={(s('format') || 'interview') === v}>{l}</option
				>{/each}
		</select>
	</div>
	<Field label="Date" name="date" id="{prefix}-date" type="date" value={s('date')} error={fields.date} />
	<Field
		label="Start time"
		name="start_time"
		id="{prefix}-time"
		type="time"
		value={s('start_time')}
		error={fields.start_time}
	/>
	<Field
		label="Duration (minutes)"
		name="duration_min"
		id="{prefix}-dur"
		type="number"
		min="5"
		max="1440"
		step="5"
		value={s('duration_min') || '60'}
		error={fields.duration_min}
	/>
</div>
<fieldset class="au-stack">
	<legend>Participants</legend>
	{#each people as p (p.id)}
		<label class="au-check-row"
			><input
				type="checkbox"
				name="participant"
				value={p.id}
				checked={list('participant_ids').includes(p.id)}
			/>
			{p.label}</label
		>
	{:else}
		<p class="au-muted">No roles recorded yet; add them on Set-up, Auditee, or name participants below.</p>
	{/each}
</fieldset>
<Field
	label="Other participants (optional)"
	name="participants_note"
	id="{prefix}-note"
	value={s('participants_note')}
	placeholder="To be agreed"
/>
<Field label="Location (optional)" name="location" id="{prefix}-loc" value={s('location')} />
{#if requirements.length}
	<RequirementChecklist
		id="{prefix}-req"
		name="requirement"
		label="Requirements this event validates"
		items={requirements}
		selected={list('requirement_ids')}
	/>
{/if}
{#if fields.requirement_ids}<span class="au-field__error">{fields.requirement_ids}</span>{/if}
{#if showStatus}
	<div class="au-field">
		<label for="{prefix}-status">Status</label>
		<select id="{prefix}-status" name="status">
			<option value="planned" selected={s('status') !== 'held'}>Planned</option>
			<option value="held" selected={s('status') === 'held'}>Held</option>
		</select>
	</div>
{/if}
