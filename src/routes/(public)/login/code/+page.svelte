<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';

	let { data, form } = $props();
	let busy = $state(false);
	const submit = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
		};
	};
</script>

<svelte:head><title>Sign in with a code · mcp-audit</title></svelte:head>

<main class="au-auth">
	<div class="au-auth__card">
		<h1 class="au-screen__title">Sign in with a code</h1>
		<FormMessage {form} />
		{#if data.linkProblem}<div class="au-alert au-alert--danger" role="alert">{data.linkProblem}</div>{/if}

		{#if data.step === 'other-browser'}
			<div class="au-alert au-alert--info" role="status" data-testid="other-browser">
				<p class="au-alert__title">Open this in the browser where you asked for the code</p>
				<p>
					The link works only there. You can also type the six-digit code from the same email into that
					browser.
				</p>
			</div>
			<a class="au-btn" href="/login/code">Ask for a code in this browser</a>
		{:else if data.step === 'code'}
			<p data-testid="code-sent">
				If <strong>{data.email}</strong> has an account here, a code is on its way to it. The code works for
				{data.minutes} minutes, once, and only in this browser.
			</p>
			<form method="POST" action="?/verify" class="au-form au-form--stack" use:enhance={submit}>
				<Field
					label="Sign-in code"
					name="code"
					inputmode="numeric"
					autocomplete="one-time-code"
					pattern="[0-9 ]*"
					maxlength={8}
					required
					hint="Six digits from the email"
				/>
				<button class="au-btn au-btn--primary" type="submit" disabled={busy}>Sign in</button>
			</form>
			<div class="au-row">
				<form method="POST" action="?/request" use:enhance>
					<input type="hidden" name="email" value={data.email} />
					<button class="au-btn au-btn--ghost" type="submit">Send a new code</button>
				</form>
				<form method="POST" action="?/cancel" use:enhance>
					<button class="au-btn au-btn--ghost" type="submit">Use another address</button>
				</form>
			</div>
		{:else}
			<p class="au-muted">
				For when you have no passkey on this device, or have lost it. We send a one-time code to your email
				address.
			</p>
			<form method="POST" action="?/request" class="au-form au-form--stack" use:enhance={submit}>
				<Field
					label="Email"
					name="email"
					type="email"
					autocomplete="username"
					required
					defaultValue={(form as { email?: string } | null)?.email ?? ''}
				/>
				<button class="au-btn au-btn--primary" type="submit" disabled={busy}>Email me a sign-in code</button>
			</form>
		{/if}
		<a class="au-linkbtn" href="/login">Sign in another way</a>
	</div>
</main>
