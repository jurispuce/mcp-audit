<script lang="ts">
	import EventList from '#lib/components/run/EventList.svelte';
	let { data } = $props();
	const base = $derived(`/e/${data.engagement.id}`);
</script>

<svelte:head><title>Today · Run · mcp-audit</title></svelte:head>

{#if data.todays.length}
	<h2 class="au-section__title">Today, {data.today}</h2>
	<EventList events={data.todays} {base} label="Today's events" />
{:else if data.next}
	<p class="au-muted">No events today. Next: {data.next}.</p>
	<EventList events={data.nextEvents} {base} label="Next events" />
{:else}
	<div class="au-empty">
		<p>{data.total ? 'No events today or later.' : 'No events to run. Plan and accept events first.'}</p>
		<a class="au-btn" href="{base}/run/events">All events</a>
	</div>
{/if}
