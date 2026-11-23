<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';
	import StaleNotice from '#lib/components/StaleNotice.svelte';
	import { formatWhen } from '#lib/format.ts';

	let { data, form } = $props();
	let editing = $state<string | null>(null);
	/** Which form is open: an invitation by email (#90), or a user with a one-time password. */
	let adding = $state<'invite' | 'add' | null>(null);
	let redoing = $state(false);

	type Result = {
		action?: string;
		id?: string;
		message?: string;
		success?: string;
		fields?: Record<string, string>;
		values?: Record<string, string>;
		oneTime?: { email: string; password: string; created: boolean };
		conflict?: { version: number; current: Record<string, unknown>; attempted: Record<string, unknown> };
	};
	const result = $derived((form ?? null) as Result | null);
	const resultAction = $derived(result?.action ?? result?.values?.action);
	const resultId = $derived(result?.id ?? result?.values?.id);

	function fieldsFor(id: string) {
		return resultAction === 'update' && resultId === id ? (result?.fields ?? {}) : {};
	}
	function shownFor(user: (typeof data.users)[number]): Record<string, unknown> {
		if (resultAction === 'update' && resultId === user.id) {
			if (result?.conflict) return redoing ? result.conflict.attempted : result.conflict.current;
			if (result?.values && result.message) return result.values;
		}
		return { ...user };
	}
	function versionFor(user: (typeof data.users)[number]) {
		return resultAction === 'update' && resultId === user.id && result?.conflict
			? result.conflict.version
			: user.version;
	}

	const after = () => {
		return async ({ result: r, update }: { result: { type: string }; update: () => Promise<void> }) => {
			redoing = false;
			await update();
			if (r.type === 'success') {
				editing = null;
				adding = null;
			}
		};
	};
</script>

<svelte:head><title>Users · Settings · {page.data.instance}</title></svelte:head>

{#if result?.oneTime}
	<div class="au-alert au-alert--info" role="status" data-testid="one-time-password">
		<p class="au-alert__title">
			{result.oneTime.created ? 'User added.' : 'Password reset.'} One-time password for {result.oneTime
				.email}
		</p>
		<p class="au-secret">{result.oneTime.password}</p>
		<p>
			Give it to them over a channel you trust. It is shown only now; they must choose their own password at
			first sign-in.
		</p>
	</div>
{:else if result && !result.conflict && (resultAction !== 'update' || !editing)}
	<FormMessage form={result} />
{/if}

<section class="au-section" aria-labelledby="users-title">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="users-title">Users</h2>
		{#if !adding}
			<div class="au-row">
				{#if data.canInvite}
					<button class="au-btn" type="button" onclick={() => (adding = 'invite')}>Invite user</button>
				{/if}
				{#if data.canAdd}
					<button
						class="au-btn {data.canInvite ? 'au-btn--ghost' : ''}"
						type="button"
						onclick={() => (adding = 'add')}>Add user</button
					>
				{/if}
			</div>
		{/if}
	</div>
	{#if !data.canInvite && !data.canAdd}
		<p class="au-muted">
			New people join by an invitation sent by email. Set up email first (Settings, Email).
		</p>
	{/if}

	{#if adding}
		{@const action = adding === 'invite' ? 'invite' : 'create'}
		{@const v = resultAction === action ? (result?.values ?? {}) : {}}
		{@const f = resultAction === action ? (result?.fields ?? {}) : {}}
		<form method="POST" action="?/{action}" class="au-form au-item" use:enhance={after}>
			<p class="au-muted">
				{adding === 'invite'
					? 'They get an email with a link that works once, for 7 days, and join with it.'
					: 'They get a one-time password, shown here once, that you pass on yourself.'}
			</p>
			<Field label="Name" name="name" required value={v.name ?? ''} error={f.name} />
			<Field label="Email" name="email" type="email" required value={v.email ?? ''} error={f.email} />
			<div class="au-field">
				<label for="new-role">Role</label>
				<select id="new-role" name="role">
					<option value="auditor" selected={v.role !== 'admin'}>Auditor</option>
					<option value="admin" selected={v.role === 'admin'}>Admin</option>
				</select>
			</div>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit"
					>{adding === 'invite' ? 'Send invitation' : 'Add user'}</button
				>
				<button class="au-btn au-btn--ghost" type="button" onclick={() => (adding = null)}>Cancel</button>
			</div>
		</form>
	{/if}

	<ul class="au-list">
		{#each data.users as user (user.id)}
			<li>
				<ItemCard
					ref={user.email}
					title={user.name}
					href="?item=user:{user.id}"
					badge={user.invited
						? user.active
							? { label: 'Invited', tone: 'warn' }
							: { label: 'Invitation withdrawn', tone: 'neutral' }
						: user.active
							? {
									label: user.role === 'admin' ? 'Admin' : 'Auditor',
									tone: user.role === 'admin' ? 'info' : 'neutral'
								}
							: { label: 'Deactivated', tone: 'neutral' }}
					body={user.invited && user.active
						? user.invitationUntil && user.invitationUntil > data.now
							? `Has not joined yet. The link works until ${formatWhen(user.invitationUntil)}.`
							: 'Has not joined yet. The link no longer works; send the invitation again.'
						: null}
					version={user.version}
					testid="user-{user.email}"
				>
					{#snippet actions()}
						{#if editing === user.id}
							{@const shown = shownFor(user)}
							{@const f = fieldsFor(user.id)}
							<div class="au-stack au-grow">
								{#if resultAction === 'update' && resultId === user.id && result?.conflict}
									<StaleNotice
										conflict={result.conflict}
										labels={{ name: 'Name', email: 'Email', role: 'Role' }}
										{redoing}
										onredo={() => (redoing = true)}
										onkeep={() => (redoing = false)}
									/>
								{:else if resultAction === 'update' && resultId === user.id}
									<FormMessage form={result} />
								{/if}
								{#key `${versionFor(user)}-${redoing}`}
									<form method="POST" action="?/update" class="au-form" use:enhance={after}>
										<input type="hidden" name="id" value={user.id} />
										<input type="hidden" name="base_version" value={versionFor(user)} />
										<Field
											id="name-{user.id}"
											label="Name"
											name="name"
											required
											value={String(shown.name ?? '')}
											error={f.name}
										/>
										<Field
											id="email-{user.id}"
											label="Email"
											name="email"
											type="email"
											required
											value={String(shown.email ?? '')}
											error={f.email}
										/>
										<div class="au-field">
											<label for="role-{user.id}">Role</label>
											<select id="role-{user.id}" name="role">
												<option value="auditor" selected={shown.role !== 'admin'}>Auditor</option>
												<option value="admin" selected={shown.role === 'admin'}>Admin</option>
											</select>
										</div>
										<div class="au-row">
											<button class="au-btn au-btn--primary" type="submit">Save user</button>
											<button class="au-btn au-btn--ghost" type="button" onclick={() => (editing = null)}
												>Cancel</button
											>
										</div>
									</form>
								{/key}
							</div>
						{:else}
							<button
								class="au-btn au-btn--ghost"
								type="button"
								onclick={() => ((editing = user.id), (redoing = false))}
							>
								Edit user
							</button>
							{#if user.invited}
								{#if data.canInvite}
									<form method="POST" action="?/resend" use:enhance>
										<input type="hidden" name="id" value={user.id} />
										<button class="au-btn au-btn--ghost" type="submit">Send invitation again</button>
									</form>
								{/if}
								{#if user.active}
									<form
										method="POST"
										action="?/withdraw"
										use:enhance={({ cancel }) => {
											if (!confirm(`Withdraw the invitation for ${user.name}? The link stops working.`))
												cancel();
										}}
									>
										<input type="hidden" name="id" value={user.id} />
										<button class="au-btn au-btn--danger" type="submit">Withdraw invitation</button>
									</form>
								{/if}
							{:else}
								{#if data.canAdd}
									<form method="POST" action="?/reset" use:enhance>
										<input type="hidden" name="id" value={user.id} />
										<input type="hidden" name="email" value={user.email} />
										<button class="au-btn au-btn--ghost" type="submit" disabled={!user.active}
											>Reset password</button
										>
									</form>
								{/if}
								{#if user.id !== data.user.id && user.active}
									<form
										method="POST"
										action="?/shutOut"
										use:enhance={({ cancel }) => {
											if (
												!confirm(
													`End ${user.name}'s sessions and remove their passkeys? Use this when a device is lost. They can sign in again and add a new passkey.`
												)
											)
												cancel();
										}}
									>
										<input type="hidden" name="id" value={user.id} />
										<button class="au-btn au-btn--ghost" type="submit"
											>End sessions and remove passkeys</button
										>
									</form>
								{/if}
								{#if user.id !== data.user.id}
									<form
										method="POST"
										action="?/active"
										use:enhance={({ cancel }) => {
											if (user.active && !confirm(`Deactivate ${user.name}? Their sessions and tokens end.`))
												cancel();
										}}
									>
										<input type="hidden" name="id" value={user.id} />
										<input type="hidden" name="base_version" value={user.version} />
										<input type="hidden" name="active" value={user.active ? 'false' : 'true'} />
										<button class="au-btn {user.active ? 'au-btn--danger' : ''}" type="submit">
											{user.active ? 'Deactivate user' : 'Reactivate user'}
										</button>
									</form>
								{/if}
							{/if}
						{/if}
					{/snippet}
				</ItemCard>
			</li>
		{/each}
	</ul>
</section>
