<script lang="ts">
	import GuideBar from '#lib/components/guide/GuideBar.svelte';

	let { data, children } = $props();
</script>

{#if data.guide}<GuideBar engagementId={data.engagement.id} guide={data.guide} />{/if}
{@render children()}
