<script lang="ts">
	/** Working and report language. Content is stored as received; this is what the auditor works and reports in. */
	let { label, name, value = 'en' }: { label: string; name: string; value?: string } = $props();
	const LANGUAGES = [
		['en', 'English'],
		['lv', 'Latvian'],
		['lt', 'Lithuanian'],
		['et', 'Estonian'],
		['de', 'German'],
		['ru', 'Russian']
	];
	const id = $derived(`f-${name}`);
</script>

<div class="au-field">
	<label for={id}>{label}</label>
	<select {id} {name}>
		{#each LANGUAGES as [code, label] (code)}
			<option value={code} selected={value === code}>{label}</option>
		{/each}
		{#if !LANGUAGES.some(([c]) => c === value)}<option {value} selected>{value.toUpperCase()}</option>{/if}
	</select>
</div>
