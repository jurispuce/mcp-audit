<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';

	let { form } = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Sign in · mcp-audit</title></svelte:head>

<main class="au-auth">
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
			value={form?.email ?? ''}
		/>
		<Field label="Password" name="password" type="password" autocomplete="current-password" required />
		<button class="au-btn au-btn--primary" type="submit" disabled={busy}>Sign in</button>
		<p class="au-muted">Forgot your password? Ask an admin to reset it.</p>
	</form>
</main>
