<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';

	let { form } = $props();
	const v = $derived((form?.values ?? {}) as Record<string, string>);
	const f = $derived((form?.fields ?? {}) as Record<string, string>);
</script>

<svelte:head><title>Set up · mcp-audit</title></svelte:head>

<main class="au-auth">
	<form class="au-auth__card" method="POST" use:enhance>
		<h1 class="au-screen__title">Set up mcp-audit</h1>
		<p>Create the first admin account. The set-up code is printed in the server log when the app starts.</p>
		<FormMessage {form} />
		<Field label="Set-up code" name="code" required autocomplete="off" value={v.code ?? ''} error={f.code} />
		<Field label="Your name" name="name" required autocomplete="name" value={v.name ?? ''} error={f.name} />
		<Field
			label="Email"
			name="email"
			type="email"
			required
			autocomplete="username"
			value={v.email ?? ''}
			error={f.email}
		/>
		<Field
			label="Password"
			name="password"
			type="password"
			required
			minlength={10}
			autocomplete="new-password"
			error={f.password}
			hint="At least 10 characters"
		/>
		<Field
			label="Repeat password"
			name="confirm"
			type="password"
			required
			autocomplete="new-password"
			error={f.confirm}
		/>
		<button class="au-btn au-btn--primary" type="submit">Create admin account</button>
	</form>
</main>
