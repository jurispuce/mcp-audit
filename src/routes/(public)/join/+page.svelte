<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import { guessPasskeyName, joinWithPasskey, passkeyProblem } from '#lib/passkeys-client.ts';

	let { data, form } = $props();
	let name = $state('');
	let busy = $state(false);
	let problem = $state('');
	const failed = $derived((form ?? null) as { message?: string; fields?: Record<string, string> } | null);

	$effect(() => {
		if (!name) name = guessPasskeyName(navigator.userAgent);
	});

	async function createPasskey(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		problem = '';
		try {
			window.location.assign(await joinWithPasskey(data.token, name));
		} catch (e) {
			problem = passkeyProblem(e, 'add');
			busy = false;
		}
	}
</script>

<svelte:head><title>Join {data.instance}</title></svelte:head>

<main class="au-auth">
	<div class="au-auth__card">
		<h1 class="au-screen__title">Join {data.instance}</h1>
		{#if data.problem || !data.invitee}
			<div class="au-alert au-alert--danger" role="alert" data-testid="invitation-problem">
				{data.problem}
			</div>
			<a class="au-btn" href="/login">{data.used ? 'Sign in' : 'Go to sign-in'}</a>
		{:else}
			<p data-testid="invitation">
				{#if data.first}
					This instance was set up with you, <strong>{data.invitee.name}</strong>
					({data.invitee.email}), as its first admin.
				{:else}
					{data.invitedBy ?? 'An admin'} invited you as <strong>{data.invitee.name}</strong>
					({data.invitee.email}).
				{/if}
			</p>
			{#if data.signedInAs}
				<div class="au-alert au-alert--info" role="status">
					{data.signedInAs} is signed in to this browser. Joining signs you in as {data.invitee.name} instead.
				</div>
			{/if}
			{#if problem}<div class="au-alert au-alert--danger" role="alert">{problem}</div>{/if}
			{#if failed?.message}<div class="au-alert au-alert--danger" role="alert">{failed.message}</div>{/if}

			{#if data.options.passkey}
				<form class="au-form au-form--stack" onsubmit={createPasskey}>
					<p>
						Create a passkey and this device signs you in with its fingerprint, face or PIN. There is
						{data.options.password ? 'no password to remember' : 'no password'}.
					</p>
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
						>{busy ? 'Waiting for your device…' : 'Create passkey and join'}</button
					>
				</form>
			{/if}

			{#if data.options.password}
				<form
					method="POST"
					action="?/password&t={encodeURIComponent(data.token)}"
					class="au-form au-form--stack"
					use:enhance
				>
					<p class="au-muted">
						{data.options.passkey ? 'Or set a password instead.' : 'Set a password to join.'} You sign in with
						{data.invitee.email} and this password.
					</p>
					<Field
						label="New password"
						name="password"
						type="password"
						autocomplete="new-password"
						required
						minlength={data.minPassword}
						hint="At least {data.minPassword} characters"
						error={failed?.fields?.password}
					/>
					<Field
						label="Repeat new password"
						name="repeat"
						type="password"
						autocomplete="new-password"
						required
						error={failed?.fields?.repeat}
					/>
					<button class="au-btn {data.options.passkey ? '' : 'au-btn--primary'}" type="submit"
						>Set password and join</button
					>
				</form>
			{/if}

			{#if data.options.withoutPasskey}
				<form
					method="POST"
					action="?/without&t={encodeURIComponent(data.token)}"
					class="au-form au-form--stack"
					use:enhance
				>
					<p class="au-muted">
						{data.options.passkey
							? 'This device cannot hold a passkey?'
							: 'This address cannot have passkeys.'} Join without one: each time you sign in, a code is sent to
						{data.invitee.email}.
					</p>
					<button class="au-btn {data.options.passkey ? 'au-btn--ghost' : 'au-btn--primary'}" type="submit"
						>Join without a passkey</button
					>
				</form>
			{/if}
		{/if}
	</div>
</main>
