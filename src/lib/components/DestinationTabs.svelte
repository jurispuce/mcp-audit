<script lang="ts">
	import { page } from '$app/state';
	import { DESTINATIONS, type Destination } from '#lib/navigation.ts';

	let { destination, engagementId }: { destination: Destination['key']; engagementId: string } = $props();
	const dest = $derived(DESTINATIONS.find((d) => d.key === destination)!);
</script>

<header class="au-screen__head">
	<h1 class="au-screen__title">{dest.label}</h1>
</header>
<nav class="au-tabbar" aria-label="{dest.label} tabs">
	{#each dest.tabs as t (t.path)}
		{@const href = `/e/${engagementId}${t.path}`}
		<a
			{href}
			aria-current={page.url.pathname === href || page.url.pathname.startsWith(`${href}/`)
				? 'page'
				: undefined}>{t.label}</a
		>
	{/each}
</nav>
