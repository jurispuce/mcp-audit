<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';

	import { page } from '$app/state';
	import { passkeyProblem, signInWithPasskey } from '#lib/passkeys-client.ts';

	let { data, form } = $props();
	let busy = $state(false);
	let passkeyBusy = $state(false);
	let passkeyMessage = $state('');

	async function passkey() {
		passkeyBusy = true;
		passkeyMessage = '';
		try {
			// A full load, so the new session cookie is used from the first request.
			window.location.assign(await signInWithPasskey(page.url.searchParams.get('next')));
		} catch (e) {
			passkeyMessage = passkeyProblem(e, 'sign-in');
			passkeyBusy = false;
		}
	}
</script>

<svelte:head><title>Sign in · {page.data.instance}</title></svelte:head>

{#snippet otherWays(primary: boolean)}
	{#if data.passkeys}
		{#if passkeyMessage}<div class="au-alert au-alert--danger" role="alert">{passkeyMessage}</div>{/if}
		<button
			class="au-btn {primary ? 'au-btn--primary' : ''}"
			type="button"
			onclick={passkey}
			disabled={passkeyBusy}>{passkeyBusy ? 'Waiting for your device…' : 'Sign in with a passkey'}</button
		>
	{/if}
	{#if data.codes}
		<a class="au-btn {primary && !data.passkeys ? 'au-btn--primary' : ''}" href="/login/code{page.url.search}"
			>Email me a sign-in code</a
		>
	{/if}
{/snippet}

<main class="au-auth">
	{#if data.passwords}
		<form
			class="au-auth__card"
			method="POST"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
		>
			<h1 class="au-screen__title">Sign in</h1>
			<FormMessage {form} />
			<Field
				label="Email"
				name="email"
				type="email"
				autocomplete="username"
				required
				defaultValue={form?.email ?? ''}
			/>
			<Field label="Password" name="password" type="password" autocomplete="current-password" required />
			<button class="au-btn au-btn--primary" type="submit" disabled={busy}>Sign in</button>
			<p class="au-muted">Forgot your password? Ask an admin to reset it.</p>
			{#if data.passkeys || data.codes}
				<p class="au-auth__or"><span>or</span></p>
			{/if}
			{@render otherWays(false)}
		</form>
	{:else}
		<!-- An instance without passwords (#89): a passkey, or a code by email when there is none here. -->
		<div class="au-auth__card">
			<h1 class="au-screen__title">Sign in</h1>
			{@render otherWays(true)}
			<p class="au-muted">
				No passkey on this device, or lost it? Ask for a code by email. You can add a passkey once you are
				signed in.
			</p>
		</div>
	{/if}
</main>
