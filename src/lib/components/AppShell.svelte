<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { DESTINATIONS, destinationFor } from '#lib/navigation.ts';
	import Icon from './Icon.svelte';

	interface Props {
		user: { name: string };
		engagement: { id: string; name: string } | null;
		/** Unreviewed AI proposals in the engagement. */
		proposals?: number;
		children: Snippet;
	}
	let { user, engagement, proposals = 0, children }: Props = $props();
	const proposalsLabel = $derived(`${proposals} ${proposals === 1 ? 'proposal' : 'proposals'} to review`);

	const current = $derived(engagement ? destinationFor(page.url.pathname, engagement.id) : null);
	const href = (path: string) => `/e/${engagement!.id}${path}`;
	// The switcher remembers the destination, so another engagement opens at the same place.
	const switchHref = $derived(current && current !== 'home' ? `/?at=${current}` : '/');
	const outside = $derived(
		page.url.pathname.startsWith('/library')
			? 'library'
			: page.url.pathname.startsWith('/settings')
				? 'settings'
				: null
	);
</script>

<a class="au-visually-hidden" href="#main">Skip to content</a>
<div class="au-app">
	<nav class="au-rail" aria-label="Main">
		<span class="au-rail__brand">mcp-audit</span>
		<a class="au-rail__switch" href={switchHref} data-testid="engagement-switcher">
			<span class="au-muted">Engagement</span>
			<strong>{engagement?.name ?? 'Choose an engagement'}</strong>
		</a>
		{#if engagement}
			<form class="au-rail__search" method="GET" action="/e/{engagement.id}/search" role="search">
				<label class="au-visually-hidden" for="rail-q">Search this engagement</label>
				<input id="rail-q" name="q" type="search" placeholder="Search" autocomplete="off" />
			</form>
		{/if}
		{#each DESTINATIONS as d (d.key)}
			{#if engagement}
				<a class="au-nav" href={href(d.path)} aria-current={current === d.key ? 'page' : undefined}>
					<Icon name={d.icon} />{d.label}
				</a>
			{:else}
				<span class="au-nav" aria-disabled="true"><Icon name={d.icon} />{d.label}</span>
			{/if}
		{/each}
		{#if engagement && proposals > 0}
			<a
				class="au-nav"
				href={href('/proposals')}
				aria-current={page.url.pathname === href('/proposals') ? 'page' : undefined}
				data-testid="rail-proposals"
			>
				<Icon name="spark" />Proposals
				<span class="au-badge au-badge--ai" aria-label={proposalsLabel}>{proposals}</span>
			</a>
		{/if}
		<div class="au-rail__sep"></div>
		<a class="au-nav" href="/library" aria-current={outside === 'library' ? 'page' : undefined}>
			<Icon name="library" />Library
		</a>
		<a class="au-nav" href="/settings" aria-current={outside === 'settings' ? 'page' : undefined}>
			<Icon name="settings" />Settings
		</a>
		<div class="au-rail__foot">
			<span class="au-muted">Signed in as {user.name}</span>
			<form method="POST" action="/logout">
				<button class="au-nav au-nav--button" type="submit"><Icon name="signout" />Sign out</button>
			</form>
		</div>
	</nav>

	<header class="au-topbar">
		<a class="au-topbar__name" href={switchHref} data-testid="topbar-switcher"
			>{engagement?.name ?? 'mcp-audit'}</a
		>
		{#if engagement}
			<span class="au-row">
				{#if proposals > 0}
					<a
						class="au-topbar__proposals"
						href={href('/proposals')}
						aria-label={proposalsLabel}
						data-testid="topbar-proposals"><Icon name="spark" />{proposals}</a
					>
				{/if}
				<a class="au-topbar__search" href="/e/{engagement.id}/search" aria-label="Search"
					><Icon name="search" /></a
				>
			</span>
		{/if}
	</header>

	<main class="au-main" id="main">
		{@render children()}
	</main>

	{#if engagement}
		<nav class="au-bottombar" aria-label="Main">
			{#each DESTINATIONS as d (d.key)}
				<a href={href(d.path)} aria-current={current === d.key ? 'page' : undefined}
					><Icon name={d.icon} />{d.label}</a
				>
			{/each}
		</nav>
	{/if}
</div>
