<script lang="ts">
	import Field from './Field.svelte';
	import RequirementChecklist from './RequirementChecklist.svelte';

	interface Props {
		prefix: string;
		values: Record<string, string>;
		fields?: Record<string, string>;
		requirements: { id: string; refCode: string; title: string }[];
		scopes: { id: string; name: string }[];
		multiple: boolean;
	}
	let { prefix, values, fields = {}, requirements, scopes, multiple }: Props = $props();
	const LEVELS = [
		['high', 'High'],
		['medium', 'Medium'],
		['low', 'Low']
	];
	const ORIGINS = [
		['auditee_register', 'Auditee register'],
		['auditor', 'Auditor view']
	];
	const ticked = (v: string | undefined) => (v ? v.split(',').filter(Boolean) : []);
</script>

<Field
	label="Risk"
	name="title"
	id="{prefix}-title"
	required
	value={values.title ?? ''}
	error={fields.title}
	placeholder="Leaver accounts stay active"
/>
<div class="au-field">
	<label for="{prefix}-description">Description (optional)</label>
	<textarea id="{prefix}-description" name="description" rows="2" defaultValue={values.description ?? ''}
	></textarea>
</div>
<div class="au-row">
	<div class="au-field">
		<label for="{prefix}-level">Level</label>
		<select id="{prefix}-level" name="level">
			{#each LEVELS as [v, l] (v)}<option value={v} selected={(values.level || 'medium') === v}>{l}</option
				>{/each}
		</select>
	</div>
	<div class="au-field">
		<label for="{prefix}-origin">Origin</label>
		<select id="{prefix}-origin" name="origin">
			{#each ORIGINS as [v, l] (v)}<option value={v} selected={(values.origin || 'auditor') === v}>{l}</option
				>{/each}
		</select>
	</div>
</div>
{#if requirements.length}
	<RequirementChecklist
		id="{prefix}-req"
		name="requirement"
		label="Affected requirements"
		items={requirements}
		selected={ticked(values.requirements)}
	/>
{:else}
	<p class="au-muted">Select requirements first; a risk points at the requirements it affects.</p>
{/if}
{#if fields.requirement_ids}<span class="au-field__error">{fields.requirement_ids}</span>{/if}
{#if multiple && scopes.length > 1}
	<fieldset class="au-stack">
		<legend>Scopes (optional; none means all)</legend>
		{#each scopes as s (s.id)}
			<label class="au-check-row"
				><input type="checkbox" name="scope" value={s.id} checked={ticked(values.scopes).includes(s.id)} />
				{s.name}</label
			>
		{/each}
	</fieldset>
{/if}
