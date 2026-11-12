<script lang="ts">
	/** Placeholder for a screen whose content is built in a later issue. */
	let { title, issue, heading = false }: { title: string; issue: number; heading?: boolean } = $props();
</script>

<svelte:head><title>{title} · mcp-audit</title></svelte:head>

{#if heading}
	<header class="au-screen__head"><h1 class="au-screen__title">{title}</h1></header>
{/if}
<div class="au-empty" data-testid="empty-screen">
	<p>{title} is built in issue #{issue}.</p>
</div>
