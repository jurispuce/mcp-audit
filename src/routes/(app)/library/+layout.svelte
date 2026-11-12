<script lang="ts">
	import { page } from '$app/state';
	let { data, children } = $props();
	const TABS = [
		{ label: 'Sources', href: '/library' },
		{ label: 'Review', href: '/library/review' },
		{ label: 'Mapping', href: '/library/mapping' },
		{ label: 'Import', href: '/library/import' }
	];
	const current = $derived(
		TABS.slice()
			.reverse()
			.find((t) => page.url.pathname === t.href || page.url.pathname.startsWith(`${t.href}/`))?.href
	);
</script>

<section class="au-screen">
	<header class="au-screen__head"><h1 class="au-screen__title">Library</h1></header>
	<nav class="au-tabbar" aria-label="Library tabs">
		{#each TABS as t (t.href)}
			<a href={t.href} aria-current={current === t.href ? 'page' : undefined}
				>{t.label}{#if t.label === 'Review' && data.proposalCount}<span
						class="au-tab__count"
						data-testid="review-count">{data.proposalCount}</span
					>{/if}</a
			>
		{/each}
	</nav>
	{@render children()}
</section>
