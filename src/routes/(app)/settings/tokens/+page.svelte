<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';

	let { data, form } = $props();
	const fmt = (d: Date | null) =>
		d ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(d) : 'never';
	const f = $derived((form?.fields ?? {}) as Record<string, string>);
</script>

<svelte:head><title>Access tokens · Settings · mcp-audit</title></svelte:head>

<section class="au-section" aria-labelledby="tokens-title">
	<h2 class="au-section__title" id="tokens-title">Personal access tokens</h2>
	<p>
		A token lets Claude (or another MCP client) work in mcp-audit as you. Everything it writes is recorded as
		"Claude on behalf of {data.user.name}". The MCP endpoint is <span class="au-ref">{data.mcpUrl}</span>.
	</p>

	{#if form?.created}
		<div class="au-alert au-alert--info" role="status" data-testid="new-token">
			<p class="au-alert__title">Token "{form.created.name}" created. Copy it now: it is shown only once.</p>
			<p class="au-secret">{form.created.token}</p>
		</div>
	{:else}
		<FormMessage {form} />
	{/if}

	<form method="POST" action="?/create" class="au-form" use:enhance>
		<Field
			label="Token name"
			name="name"
			required
			maxlength={80}
			placeholder="Claude Desktop on my laptop"
			value={String(form?.values?.name ?? '')}
			error={f.name}
		/>
		<div><button class="au-btn au-btn--primary" type="submit">Create token</button></div>
	</form>

	{#if data.tokens.length === 0}
		<div class="au-empty">
			No tokens yet. Create one for each place you connect from, so you can revoke them separately.
		</div>
	{:else}
		<ul class="au-list">
			{#each data.tokens as t (t.id)}
				<li class="au-item" class:au-item--locked={!!t.revokedAt}>
					<div class="au-item__head">
						<div>
							<span class="au-ref">{t.prefix}…</span>
							<h3 class="au-item__title">{t.name}</h3>
						</div>
						<span class="au-badge" class:au-badge--ok={!t.revokedAt}
							>{t.revokedAt ? 'Revoked' : 'Active'}</span
						>
					</div>
					<div class="au-item__meta">
						<span>Created {fmt(t.createdAt)}</span>
						<span>Last used {fmt(t.lastUsedAt)}</span>
						{#if t.revokedAt}<span>Revoked {fmt(t.revokedAt)}</span>{/if}
					</div>
					{#if !t.revokedAt}
						<form
							class="au-item__actions"
							method="POST"
							action="?/revoke"
							use:enhance={({ cancel }) => {
								if (!confirm(`Revoke "${t.name}"? Anything using it stops working.`)) cancel();
							}}
						>
							<input type="hidden" name="id" value={t.id} />
							<button class="au-btn au-btn--danger" type="submit">Revoke token</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
