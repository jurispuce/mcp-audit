<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { DESTINATIONS, destinationFor } from '#lib/navigation.ts';
	import Icon from './Icon.svelte';

	interface Props {
		user: { name: string };
		engagement: { id: string; name: string } | null;
		children: Snippet;
	}
	let { user, engagement, children }: Props = $props();

	const current = $derived(engagement ? destinationFor(page.url.pathname, engagement.id) : null);
	const href = (path: string) => `/e/${engagement!.id}${path}`;
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
		<a class="au-rail__switch" href="/" data-testid="engagement-switcher">
			<span class="au-muted">Engagement</span>
			<strong>{engagement?.name ?? 'Choose an engagement'}</strong>
		</a>
		{#each DESTINATIONS as d (d.key)}
			{#if engagement}
				<a class="au-nav" href={href(d.path)} aria-current={current === d.key ? 'page' : undefined}>
					<Icon name={d.icon} />{d.label}
				</a>
			{:else}
				<span class="au-nav" aria-disabled="true"><Icon name={d.icon} />{d.label}</span>
			{/if}
		{/each}
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
		<a class="au-topbar__name" href="/" data-testid="topbar-switcher">{engagement?.name ?? 'mcp-audit'}</a>
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
