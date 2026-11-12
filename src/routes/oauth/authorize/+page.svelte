<script lang="ts">
	let { data, form } = $props();
	const error = $derived((form as { error?: string } | null)?.error ?? data.error);
</script>

<svelte:head><title>Connect an app · mcp-audit</title></svelte:head>

<main class="au-auth">
	<div class="au-auth__card" data-testid="oauth-consent">
		{#if error || !data.client}
			<h1 class="au-screen__title">Cannot connect this app</h1>
			<div class="au-alert au-alert--danger" role="alert">{error}</div>
			<p class="au-muted">Nothing was shared. You can close this page.</p>
		{:else}
			<h1 class="au-screen__title">Connect {data.client.name} to mcp-audit?</h1>
			<p>
				<strong>{data.client.name}</strong> asks to use mcp-audit as you, {data.user.name} ({data.user
					.email}).
			</p>
			<ul class="au-oauth-list">
				<li>It can read what you can read and propose changes through the mcp-audit tools.</li>
				<li>
					Everything it writes is versioned as “{data.client.name} on behalf of {data.user.name}”, and its
					judgements (roles, internal requirements, evidence links, findings) wait as proposals for a person
					to accept.
				</li>
				<li>It cannot approve findings, change plan status or delete files.</li>
				<li>Disconnect it any time in Settings, Access tokens.</li>
			</ul>
			<p class="au-muted">
				After you allow it, you return to <span class="au-ref">{data.returnsTo}</span>{data.client.uri
					? ` (the app says it is ${data.client.uri})`
					: ''}. Only allow apps you added yourself.
			</p>
			<div class="au-row">
				<form method="POST" action="?/approve">
					<input type="hidden" name="params" value={data.params} />
					<button class="au-btn au-btn--primary" type="submit">Allow access</button>
				</form>
				<form method="POST" action="?/deny">
					<input type="hidden" name="params" value={data.params} />
					<button class="au-btn au-btn--ghost" type="submit">Deny</button>
				</form>
			</div>
		{/if}
	</div>
</main>
