<script lang="ts">
	import { addPasskey, guessPasskeyName, passkeyProblem } from '#lib/passkeys-client.ts';

	let { data } = $props();
	let name = $state('');
	let busy = $state(false);
	let problem = $state('');

	$effect(() => {
		if (!name) name = guessPasskeyName(navigator.userAgent);
	});

	async function add(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		problem = '';
		try {
			await addPasskey(name);
			window.location.assign(data.next);
		} catch (e) {
			problem = passkeyProblem(e, 'add');
			busy = false;
		}
	}
</script>

<svelte:head><title>Add a passkey · mcp-audit</title></svelte:head>

<main class="au-auth">
	<form class="au-auth__card" onsubmit={add}>
		<h1 class="au-screen__title">Add a passkey to this device</h1>
		<p>
			You signed in with a code by email. With a passkey, this device signs you in with its fingerprint, face
			or PIN next time, with no code to wait for.
		</p>
		{#if data.count}
			<p class="au-muted">
				You have {data.count}
				{data.count === 1 ? 'passkey' : 'passkeys'} on other devices; each device needs its own unless your passkeys
				are synced.
			</p>
		{/if}
		{#if problem}<div class="au-alert au-alert--danger" role="alert">{problem}</div>{/if}
		<div class="au-field">
			<label for="passkey-name">Name for the passkey</label>
			<input
				id="passkey-name"
				name="passkey_name"
				type="text"
				maxlength="60"
				autocomplete="off"
				bind:value={name}
			/>
		</div>
		<button class="au-btn au-btn--primary" type="submit" disabled={busy}
			>{busy ? 'Waiting for your device…' : 'Add passkey'}</button
		>
		<a class="au-btn au-btn--ghost" href={data.next}>Continue without a passkey</a>
	</form>
</main>
