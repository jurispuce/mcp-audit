<script lang="ts">
	import { page } from '$app/state';
	import CopyBox from '#lib/components/guide/CopyBox.svelte';
	import Rich from '#lib/components/guide/Rich.svelte';
	import {
		AFTER,
		CLIENTS,
		NOT_PUBLIC_NOTE,
		connectorReady,
		fill,
		signInNote,
		type GuideClient
	} from '#lib/guide/content.ts';

	let { data } = $props();
	const ready = $derived(connectorReady(data.mcpUrl));
	// Connectors need a public https address; on a private one, start with a client that does not.
	let chosen = $state<GuideClient['key'] | null>(null);
	const key = $derived(chosen ?? (ready ? 'claude' : 'claude-code'));
	const client = $derived(CLIENTS.find((c) => c.key === key)!);
</script>

<svelte:head><title>Connect your AI · Guide · {page.data.instance}</title></svelte:head>

<p class="au-guide-intro">
	Your own assistant can work on the same records through the MCP connector, under the same rules: what it
	writes is versioned on your behalf, and judgement arrives as proposals.
</p>

<section class="au-section" aria-labelledby="address-title">
	<h2 class="au-section__title" id="address-title">This instance's MCP address</h2>
	<CopyBox text={data.mcpUrl} label="MCP address" testid="mcp-address" />
	{#if !ready}
		<div class="au-alert au-alert--warn" role="status" data-testid="not-public">{NOT_PUBLIC_NOTE}</div>
	{/if}
</section>

<section class="au-section" aria-labelledby="client-title">
	<h2 class="au-section__title" id="client-title">Choose your assistant</h2>
	<div class="au-row" role="tablist" aria-label="Assistant">
		{#each CLIENTS as c (c.key)}
			<button
				class="au-btn"
				class:au-btn--primary={c.key === key}
				type="button"
				role="tab"
				id="client-{c.key}"
				aria-selected={c.key === key}
				aria-controls="client-panel"
				onclick={() => (chosen = c.key)}>{c.label}</button
			>
		{/each}
	</div>

	<div
		class="au-item"
		role="tabpanel"
		id="client-panel"
		aria-labelledby="client-{client.key}"
		data-testid="client-{client.key}"
	>
		<p>
			{client.summary}
			<span class="au-badge {client.needs === 'public' ? 'au-badge--info' : 'au-badge--neutral'}"
				>{client.needs === 'public' ? 'Needs a public https address' : 'Uses an access token'}</span
			>
		</p>
		{#if client.unverified}
			<div class="au-alert au-alert--warn" role="note" data-testid="unverified">{client.unverified}</div>
		{/if}
		<ol class="au-guide-list au-guide-list--steps">
			{#each client.steps as step, i (i)}
				<li>
					<Rich text={step.text} />
					{#if step.code}<CopyBox text={fill(step.code, data.mcpUrl)} label="step {i + 1}" />{/if}
				</li>
			{/each}
		</ol>
		{#if client.needs === 'token'}
			<div><a class="au-btn au-btn--small" href="/settings/tokens">Open Settings, Access tokens</a></div>
		{:else}
			<p class="au-muted" data-testid="sign-in-note"><Rich text={signInNote(data.signIn)} /></p>
		{/if}
		<ul class="au-guide-list au-muted">
			{#each client.notes as note (note)}<li><Rich text={note} /></li>{/each}
		</ul>
	</div>
</section>

<section class="au-section" aria-labelledby="after-title">
	<h2 class="au-section__title" id="after-title">After connecting</h2>
	<ul class="au-guide-rules">
		{#each AFTER as a (a.title)}
			<li>
				<strong>{a.title}</strong><span class="au-muted">{a.text}</span>
				{#if a.link}<a class="au-linkbtn" href={a.link.href}>{a.link.label}</a>{/if}
			</li>
		{/each}
	</ul>
</section>
