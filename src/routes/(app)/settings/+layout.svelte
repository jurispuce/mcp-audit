<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { data, children } = $props();
	const tabs = $derived([
		{ href: resolve('/(app)/settings'), label: 'Account' },
		...(data.user.role === 'admin' ? [{ href: resolve('/(app)/settings/users'), label: 'Users' }] : []),
		{ href: resolve('/(app)/settings/tokens'), label: 'Access tokens' }
	]);
</script>

<section class="au-screen">
	<header class="au-screen__head">
		<h1 class="au-screen__title">Settings</h1>
	</header>
	<nav class="au-tabbar" aria-label="Settings">
		{#each tabs as t (t.href)}
			<a href={t.href} aria-current={page.url.pathname === t.href ? 'page' : undefined}>{t.label}</a>
		{/each}
	</nav>
	{@render children()}
	<p class="au-muted" data-testid="app-version">mcp-audit version {data.version}</p>
</section>
