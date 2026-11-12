<script lang="ts">
	import Field from '../Field.svelte';

	/** Planned evidence fields. Criticality left empty takes the highest linked risk level. */
	interface Props {
		prefix: string;
		values: Record<string, unknown>;
		fields?: Record<string, string>;
		requirements: { id: string; refCode: string; title: string }[];
		scopes: { id: string; name: string }[];
		multiple: boolean;
		kinds: [string, string][];
		statuses?: [string, string][];
	}
	let { prefix, values, fields = {}, requirements, scopes, multiple, kinds, statuses }: Props = $props();
	const s = (k: string) => (values[k] == null ? '' : String(values[k]));
	const list = (k: string) =>
		Array.isArray(values[k]) ? (values[k] as string[]) : s(k) ? s(k).split(',') : [];
	let status = $derived(s('status') || 'planned');
</script>

<Field
	label="What do you expect to see?"
	name="text"
	id="{prefix}-text"
	required
	value={s('text')}
	error={fields.text}
	placeholder="Access review records for the last two cycles"
/>
<div class="au-row au-wrap">
	<div class="au-field">
		<label for="{prefix}-kind">Kind</label>
		<select id="{prefix}-kind" name="kind"
			>{#each kinds as [v, l] (v)}<option value={v} selected={(s('kind') || 'record') === v}>{l}</option
				>{/each}</select
		>
	</div>
	<div class="au-field">
		<label for="{prefix}-crit">Criticality</label>
		<select id="{prefix}-crit" name="criticality">
			{#if !statuses}<option value="">From risks</option>{/if}
			{#each [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] as [v, l] (v)}<option
					value={v}
					selected={s('criticality') === v}>{l}</option
				>{/each}
		</select>
	</div>
	{#if multiple && scopes.length > 1}
		<div class="au-field">
			<label for="{prefix}-scope">Scope</label>
			<select id="{prefix}-scope" name="scope_id">
				<option value="">All scopes</option>
				{#each scopes as sc (sc.id)}<option value={sc.id} selected={s('scope_id') === sc.id}>{sc.name}</option
					>{/each}
			</select>
		</div>
	{/if}
	{#if statuses}
		<div class="au-field">
			<label for="{prefix}-status">Status</label>
			<select id="{prefix}-status" name="status" bind:value={status}
				>{#each statuses as [v, l] (v)}<option value={v}>{l}</option>{/each}</select
			>
		</div>
	{/if}
</div>
{#if statuses && status === 'promised'}
	<div class="au-row au-wrap">
		<Field label="Promised by" name="promised_by" id="{prefix}-pby" value={s('promised_by')} />
		<Field
			label="Due"
			name="promised_due"
			id="{prefix}-pdue"
			type="date"
			value={s('promised_due')}
			error={fields.promised_due}
		/>
	</div>
{/if}
<fieldset class="au-stack">
	<legend>Requirements</legend>
	{#each requirements as r (r.id)}
		<label class="au-check-row"
			><input
				type="checkbox"
				name="requirement"
				value={r.id}
				checked={list('requirement_ids').includes(r.id)}
			/> <span><span class="au-ref">{r.refCode}</span> {r.title}</span></label
		>
	{:else}
		<p class="au-muted">Add requirements to the event first.</p>
	{/each}
</fieldset>
