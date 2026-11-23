<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import { confirmWithPasskey } from '#lib/passkeys-client.ts';
	import type { SubmitFunction } from './$types';

	let { data, form } = $props();
	/** Creating a token needs a fresh proof (#93): the passkey is asked for, then the form goes again. */
	let confirming = $state(false);
	let confirmProblem = $state('');
	let confirmed = false;
	const createToken: SubmitFunction = () => {
		confirmProblem = '';
		return async ({ result, update, formElement }) => {
			const stale = result.type === 'failure' && (result.data as { recheck?: boolean } | undefined)?.recheck;
			if (stale && data.canConfirmWithPasskey && !confirmed) {
				confirming = true;
				try {
					await confirmWithPasskey();
					confirmed = true;
					formElement.requestSubmit();
					return;
				} catch (e) {
					const err = e as { name?: string; message?: string };
					confirmProblem =
						err?.name === 'NotAllowedError'
							? 'Your passkey was not used, so no token was created. Try again.'
							: err?.message || 'Your passkey could not be checked. Try again.';
				} finally {
					confirming = false;
				}
				return;
			}
			confirmed = false;
			await update({ reset: !stale });
		};
	};
	const needsSignIn = $derived(!!form?.recheck && !data.canConfirmWithPasskey);
	const fmt = (d: Date | null) =>
		d ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(d) : 'never';
	const f = $derived((form?.fields ?? {}) as Record<string, string>);
</script>

<svelte:head><title>Access tokens · Settings · {page.data.instance}</title></svelte:head>

<section class="au-section" aria-labelledby="apps-title">
	<h2 class="au-section__title" id="apps-title">Connected apps</h2>
	<p>
		Apps you allowed through sign-in, such as Claude added as a custom connector with the address
		<span class="au-ref">{data.mcpUrl}</span>. They work as you, like a token.
	</p>
	{#if data.apps.length === 0}
		<div class="au-empty" data-testid="no-connected-apps">No apps connected.</div>
	{:else}
		<ul class="au-list" aria-label="Connected apps">
			{#each data.apps as a (a.grantId)}
				<li class="au-item" data-testid="app-{a.clientName}">
					<div class="au-item__head">
						<div>
							{#if a.clientUri}<span class="au-ref">{a.clientUri}</span>{/if}
							<h3 class="au-item__title">{a.clientName}</h3>
						</div>
						<span class="au-badge au-badge--ok">Connected</span>
					</div>
					<div class="au-item__meta">
						<span>Connected {fmt(a.connectedAt)}</span>
						<span>Last used {fmt(a.lastUsedAt)}</span>
					</div>
					<form
						class="au-item__actions"
						method="POST"
						action="?/disconnect"
						use:enhance={({ cancel }) => {
							if (!confirm(`Disconnect "${a.clientName}"? It stops working until you allow it again.`))
								cancel();
						}}
					>
						<input type="hidden" name="grant" value={a.grantId} />
						<button class="au-btn au-btn--danger" type="submit">Disconnect {a.clientName}</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

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
	{:else if needsSignIn}
		<div class="au-alert au-alert--info" role="alert" data-testid="sign-in-again">
			<p class="au-alert__title">Sign in again to create a token</p>
			<p>
				A token is a long-lived key to everything you can reach, so creating one needs a sign-in no older than
				{data.recheckMinutes} minutes. You come back to this page.
			</p>
			<form method="POST" action="?/signInAgain">
				<button class="au-btn" type="submit">Sign in again</button>
			</form>
		</div>
	{:else if confirmProblem}
		<div class="au-alert au-alert--danger" role="alert">{confirmProblem}</div>
	{:else if !form?.recheck}
		<FormMessage {form} />
	{/if}

	<form method="POST" action="?/create" class="au-form" use:enhance={createToken}>
		<Field
			label="Token name"
			name="name"
			required
			maxlength={80}
			placeholder="Claude Desktop on my laptop"
			value={String(form?.values?.name ?? '')}
			error={f.name}
		/>
		<div>
			<button class="au-btn au-btn--primary" type="submit" disabled={confirming}
				>{confirming ? 'Waiting for your passkey…' : 'Create token'}</button
			>
		</div>
		<p class="au-muted">
			{data.canConfirmWithPasskey
				? `If you signed in more than ${data.recheckMinutes} minutes ago, your passkey is asked for again.`
				: `If you signed in more than ${data.recheckMinutes} minutes ago, you are asked to sign in again first.`}
		</p>
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
