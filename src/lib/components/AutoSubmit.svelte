<script lang="ts">
	/** A select that saves as soon as it changes. The hidden button keeps it working before scripts load. */
	interface Props {
		label: string;
		name: string;
		value: string;
		options: [string, string][];
		testid?: string;
	}
	let { label, name, value, options, testid }: Props = $props();
	const id = `as-${Math.random().toString(36).slice(2, 8)}`;
</script>

<span class="au-field au-field--inline">
	<label for={id}>{label}</label>
	<select {id} {name} data-testid={testid} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
		{#each options as [v, l] (v)}
			<option value={v} selected={v === value}>{l}</option>
		{/each}
	</select>
	<button class="au-visually-hidden" type="submit">Save {label.toLowerCase()}</button>
</span>
