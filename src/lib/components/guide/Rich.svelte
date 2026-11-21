<script lang="ts">
	import { rich } from '#lib/guide/content.ts';

	/** Guide text with its **bold** spans. */
	let { text }: { text: string } = $props();
</script>

{#each rich(text) as part, i (i)}{#if part.bold}<strong>{part.text}</strong>{:else}{part.text}{/if}{/each}
