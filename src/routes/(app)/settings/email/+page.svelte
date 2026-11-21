<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';

	let { data, form } = $props();
	const s = $derived(data.email);
	let sending = $state(false);
	const when = (d: Date) => new Date(d).toLocaleString();
</script>

<svelte:head><title>Email · Settings · mcp-audit</title></svelte:head>

<FormMessage form={(form ?? null) as { message?: string; success?: string } | null} />

<section class="au-section" aria-labelledby="email-title">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="email-title">Outbound email</h2>
		<span class="au-badge {s.configured ? 'au-badge--ok' : 'au-badge--warn'}" data-testid="email-state"
			>{s.configured ? 'Set up' : 'Not set up'}</span
		>
	</div>
	<p class="au-muted">
		The instance sends invitations, sign-in codes and security notices by email. The mail server is set in the
		instance's environment, not here, so its password is never stored in the database or shown.
	</p>

	{#if s.configured}
		<dl class="au-dl" data-testid="email-settings">
			<dt>Sender</dt>
			<dd>{s.from}</dd>
			<dt>Mail server</dt>
			<dd>{s.host}:{s.port}</dd>
			<dt>Encryption</dt>
			<dd>
				{s.secure
					? 'Encrypted from the start (TLS)'
					: s.user
						? 'Upgraded to an encrypted connection before signing in (STARTTLS)'
						: 'Encrypted when the mail server offers it (STARTTLS)'}
			</dd>
			<dt>User name</dt>
			<dd>{s.user ?? 'None'}</dd>
			<dt>Password</dt>
			<dd>{s.hasPassword ? 'Set, not shown' : 'Not set'}</dd>
		</dl>
	{:else}
		<div class="au-alert au-alert--warn" role="status" data-testid="email-missing">
			Email is not set up: {s.missing.join(' and ')}
			{s.missing.length === 1 ? 'is' : 'are'} missing from the instance's environment. Until then nothing that needs
			email can be used. docs/deployment.md lists the settings.
		</div>
	{/if}

	<form
		method="POST"
		action="?/test"
		class="au-row"
		use:enhance={() => {
			sending = true;
			return async ({ update }) => {
				await update();
				sending = false;
			};
		}}
	>
		<button class="au-btn au-btn--primary" type="submit" disabled={!s.configured || sending}
			>{sending ? 'Sending…' : 'Send test email'}</button
		>
		<span class="au-muted">Goes to your own address, {data.myEmail}.</span>
	</form>
</section>

<section class="au-section" aria-labelledby="log-title">
	<h2 class="au-section__title" id="log-title">Recent emails</h2>
	{#if data.log.length === 0}
		<p class="au-muted">Nothing has been sent yet.</p>
	{:else}
		<p class="au-muted">
			Who was written to and whether the mail server took it. The text of an email is not kept.
		</p>
		<ul class="au-list" aria-label="Recent emails">
			{#each data.log as l (l.id)}
				<li class="au-item" data-testid="email-log">
					<div class="au-row au-between">
						<span><strong>{l.kindLabel}</strong> to {l.recipient}</span>
						<span class="au-badge {l.status === 'sent' ? 'au-badge--ok' : 'au-badge--danger'}"
							>{l.status === 'sent' ? 'Sent' : 'Not sent'}</span
						>
					</div>
					<span class="au-muted">{when(l.at)}{l.error ? ` · ${l.error}` : ''}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>
