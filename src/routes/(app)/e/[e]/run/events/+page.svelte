<script lang="ts">
	import EventList from '#lib/components/run/EventList.svelte';
	let { data } = $props();
	const base = $derived(`/e/${data.engagement.id}`);
</script>

<svelte:head><title>All events · Run · mcp-audit</title></svelte:head>

{#if data.events.length}
	<EventList events={data.events} {base} label="Events" />
{:else}
	<div class="au-empty">
		<p>No events to run. Plan and accept events first.</p>
		<a class="au-btn au-btn--primary" href="{base}/plan/events">Go to Plan</a>
	</div>
{/if}
