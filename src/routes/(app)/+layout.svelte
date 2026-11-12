<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '#lib/components/AppShell.svelte';

	let { data, children } = $props();
	const engagement = $derived((page.data.engagement as { id: string; name: string } | undefined) ?? null);
</script>

<AppShell user={data.user} {engagement}>
	{@render children()}
</AppShell>
