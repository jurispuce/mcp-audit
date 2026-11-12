<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import StaleNotice from '#lib/components/StaleNotice.svelte';

	let { data, form } = $props();

	// Which form the last result belongs to: SvelteKit reports the action name in the URL search.
	let lastAction = $state<'profile' | 'password' | null>(null);
	let redoing = $state(false);

	const profileForm = $derived(lastAction === 'profile' ? form : null);
	const passwordForm = $derived(lastAction === 'password' ? form : null);
	const conflict = $derived(profileForm?.conflict);
	const shown = $derived(
		(conflict
			? redoing
				? conflict.attempted
				: conflict.current
			: (profileForm?.values ?? data.me)) as Record<string, unknown>
	);
	const baseVersion = $derived(conflict ? conflict.version : data.me.version);
	const pf = $derived((profileForm?.fields ?? {}) as Record<string, string>);
	const wf = $derived((passwordForm?.fields ?? {}) as Record<string, string>);
	// Re-render inputs whenever what they should show changes.
	const profileKey = $derived(`${baseVersion}-${redoing}-${JSON.stringify(shown)}`);

	function track(action: 'profile' | 'password') {
		return () => {
			lastAction = action;
			return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
				redoing = false;
				await update({ reset: action === 'password' });
			};
		};
	}
</script>

<svelte:head><title>Account · Settings · mcp-audit</title></svelte:head>

{#if data.mustChangePassword}
	<div class="au-alert au-alert--info" role="status">
		<p class="au-alert__title">Choose your own password</p>
		<p>You signed in with a one-time password. Set a new one to continue.</p>
	</div>
{/if}

<section class="au-section" aria-labelledby="details-title">
	<h2 class="au-section__title" id="details-title">Your details</h2>
	{#if conflict}
		<StaleNotice
			{conflict}
			labels={{ name: 'Name', email: 'Email' }}
			{redoing}
			onredo={() => (redoing = true)}
			onkeep={() => (redoing = false)}
		/>
	{:else}
		<FormMessage form={profileForm} />
	{/if}
	{#key profileKey}
		<form method="POST" action="?/profile" class="au-form" use:enhance={track('profile')}>
			<input type="hidden" name="base_version" value={baseVersion} />
			<Field
				label="Name"
				name="name"
				required
				value={String(shown.name ?? '')}
				error={pf.name}
				autocomplete="name"
			/>
			<Field
				label="Email"
				name="email"
				type="email"
				required
				value={String(shown.email ?? '')}
				error={pf.email}
				autocomplete="email"
			/>
			<div><button class="au-btn au-btn--primary" type="submit">Save details</button></div>
		</form>
	{/key}
	<p class="au-muted">
		Version {data.me.version} · role {data.me.role === 'admin' ? 'Admin' : 'Auditor'}
	</p>
</section>

<section class="au-section" aria-labelledby="password-title">
	<h2 class="au-section__title" id="password-title">Password</h2>
	<FormMessage form={passwordForm} />
	<form method="POST" action="?/password" class="au-form au-form--stack" use:enhance={track('password')}>
		<Field
			label="Current password"
			name="current"
			type="password"
			required
			autocomplete="current-password"
			error={wf.current}
		/>
		<Field
			label="New password"
			name="password"
			type="password"
			required
			minlength={10}
			autocomplete="new-password"
			error={wf.password}
			hint="At least 10 characters"
		/>
		<Field
			label="Repeat new password"
			name="confirm"
			type="password"
			required
			autocomplete="new-password"
			error={wf.confirm}
		/>
		<div><button class="au-btn" type="submit">Change password</button></div>
	</form>
</section>
