<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Field from '#lib/components/Field.svelte';
	import { addPasskey, guessPasskeyName, passkeyProblem } from '#lib/passkeys-client.ts';

	/**
	 * A person's passkeys on Settings, Account (#87): add one on this device, rename, remove.
	 * Rename and remove are form actions of the page; adding talks to the device, so it runs here.
	 */
	interface Props {
		passkeys: { id: string; name: string; synced: boolean; createdAt: Date; lastUsedAt: Date | null }[];
		/** False where the address cannot have passkeys (not https, or an IP address). */
		possible: boolean;
		/** The result of the page's rename or remove action. */
		result?: { message?: string; success?: string } | null;
		ontrack?: () => unknown;
	}
	let { passkeys, possible, result = null, ontrack }: Props = $props();

	let name = $state('');
	let busy = $state(false);
	let problem = $state('');
	let added = $state('');
	let renaming = $state<string | null>(null);
	const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString() : 'never');

	$effect(() => {
		if (!name) name = guessPasskeyName(navigator.userAgent);
	});

	async function add(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		problem = '';
		added = '';
		try {
			const made = await addPasskey(name);
			added = `Passkey “${made.name}” added. You can sign in with it from now on.`;
			await invalidateAll();
		} catch (e) {
			problem = passkeyProblem(e, 'add');
		} finally {
			busy = false;
		}
	}
	const track = () => {
		ontrack?.();
		return async ({ update }: { update: () => Promise<void> }) => {
			problem = '';
			added = '';
			await update();
			renaming = null;
		};
	};
</script>

<section class="au-section" aria-labelledby="passkeys-title">
	<h2 class="au-section__title" id="passkeys-title">Passkeys</h2>
	<p class="au-muted">
		A passkey signs you in with this device's fingerprint, face or PIN instead of a password. It works only on
		this address, so it cannot be tricked out of you by a look-alike site. Add one on each device you use.
	</p>
	{#if problem}<div class="au-alert au-alert--danger" role="alert">{problem}</div>{/if}
	{#if added}<div class="au-alert au-alert--ok" role="status">{added}</div>{/if}
	{#if result?.message}<div class="au-alert au-alert--danger" role="alert">{result.message}</div>{/if}
	{#if result?.success}<div class="au-alert au-alert--ok" role="status">{result.success}</div>{/if}

	{#if passkeys.length}
		<ul class="au-list" aria-label="Your passkeys">
			{#each passkeys as p (p.id)}
				<li class="au-item" data-testid="passkey">
					<div class="au-row au-between">
						<strong>{p.name}</strong>
						<span class="au-badge au-badge--neutral"
							>{p.synced ? 'Synced between your devices' : 'On one device'}</span
						>
					</div>
					<span class="au-muted">Added {day(p.createdAt)} · last used {day(p.lastUsedAt)}</span>
					{#if renaming === p.id}
						<form method="POST" action="?/renamePasskey" class="au-form" use:enhance={track}>
							<input type="hidden" name="id" value={p.id} />
							<Field label="Name" name="name" id="passkey-name-{p.id}" value={p.name} required />
							<div class="au-row">
								<button class="au-btn au-btn--primary au-btn--small" type="submit">Save name</button>
								<button
									class="au-btn au-btn--ghost au-btn--small"
									type="button"
									onclick={() => (renaming = null)}>Cancel</button
								>
							</div>
						</form>
					{:else}
						<div class="au-row">
							<button
								class="au-btn au-btn--small"
								type="button"
								onclick={() => (renaming = p.id)}
								aria-label="Rename passkey {p.name}">Rename</button
							>
							<form method="POST" action="?/removePasskey" use:enhance={track}>
								<input type="hidden" name="id" value={p.id} />
								<button
									class="au-btn au-btn--small au-btn--ghost"
									type="submit"
									aria-label="Remove passkey {p.name}">Remove</button
								>
							</form>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="au-muted" data-testid="no-passkeys">You have no passkey yet.</p>
	{/if}

	{#if possible}
		<form class="au-form" onsubmit={add}>
			<div class="au-field">
				<label for="new-passkey-name">Name for the new passkey</label>
				<input
					id="new-passkey-name"
					name="passkey_name"
					type="text"
					maxlength="60"
					autocomplete="off"
					aria-describedby="new-passkey-hint"
					bind:value={name}
				/>
				<span class="au-muted" id="new-passkey-hint">So you can tell your devices apart</span>
			</div>
			<div>
				<button class="au-btn au-btn--primary" type="submit" disabled={busy}
					>{busy ? 'Waiting for your device…' : 'Add passkey'}</button
				>
			</div>
		</form>
	{:else}
		<div class="au-alert au-alert--info" role="status" data-testid="passkeys-not-possible">
			Passkeys need the app at an https address with a host name. This address cannot have them.
		</div>
	{/if}
</section>
