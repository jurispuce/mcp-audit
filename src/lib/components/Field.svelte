<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends HTMLInputAttributes {
		label: string;
		name: string;
		error?: string | undefined;
		hint?: string | undefined;
	}
	let { label, name, error, hint, value, type = 'text', id: givenId, ...rest }: Props = $props();
	const id = $derived(givenId ?? `f-${name}`);
	const describedBy = $derived(error ? `${id}-err` : hint ? `${id}-hint` : undefined);
</script>

<div class="au-field" data-invalid={error ? '' : undefined}>
	<label for={id}>{label}</label>
	<input
		{id}
		{name}
		{type}
		{value}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
		{...rest}
	/>
	{#if error}
		<span class="au-field__error" id="{id}-err">{error}</span>
	{:else if hint}
		<span class="au-muted" id="{id}-hint">{hint}</span>
	{/if}
</div>
