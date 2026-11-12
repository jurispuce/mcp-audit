<script lang="ts">
	import FindingCard from './FindingCard.svelte';

	/** A list of finding cards; a failed save shows on the card it belongs to. */
	let {
		cards,
		scale,
		multipleScopes,
		form,
		label
	}: {
		cards: Parameters<typeof FindingCard>[1]['card'][];
		scale: Parameters<typeof FindingCard>[1]['scale'];
		multipleScopes: boolean;
		form: { message?: string; values?: Record<string, string> } | null;
		label: string;
	} = $props();
</script>

<ul class="au-list" aria-label={label}>
	{#each cards as card (card.unitId)}
		<li>
			<FindingCard {card} {scale} {multipleScopes} error={form?.values?.unit === card.unitId ? form : null} />
		</li>
	{/each}
</ul>
