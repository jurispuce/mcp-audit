<script lang="ts">
	import { page } from '$app/state';

	let { data, children } = $props();
	const q = $derived(data.engagement ? `?e=${data.engagement.id}` : '');
	const tabs = $derived([
		{ path: '/guide', label: 'Audit steps' },
		{ path: '/guide/connect', label: 'Connect your AI' }
	]);
</script>

<section class="au-screen">
	<header class="au-screen__head">
		<h1 class="au-screen__title">Guide</h1>
		<a class="au-btn" href="/guide/download" download data-testid="guide-download">Download guide</a>
	</header>
	<nav class="au-tabbar" aria-label="Guide">
		{#each tabs as t (t.path)}
			<a href="{t.path}{q}" aria-current={page.url.pathname === t.path ? 'page' : undefined}>{t.label}</a>
		{/each}
	</nav>
	{@render children()}
</section>
