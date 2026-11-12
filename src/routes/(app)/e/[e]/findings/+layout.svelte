<script lang="ts">
	import DestinationTabs from '#lib/components/DestinationTabs.svelte';
	let { data, children } = $props();
</script>

<section class="au-screen">
	<DestinationTabs destination="findings" engagementId={data.engagement.id} />
	{@render children()}
</section>
