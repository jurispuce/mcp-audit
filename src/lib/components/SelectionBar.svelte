<script lang="ts">
	import { enhance } from '$app/forms';

	/**
	 * Accept or reject several proposals at once. The checkboxes sit on the cards (each card keeps its
	 * own Accept and Reject) and belong to this bar's form through their `form` attribute; their name is
	 * `ids`. Stays at the bottom of the screen while anything is selected.
	 */
	interface Props {
		/** The form id the checkboxes point at. */
		id: string;
		/** Every selectable value on the screen, for Select all. */
		all: string[];
		selected: string[];
		/** Form actions, for example "?/acceptSelected". */
		acceptAction: string;
		rejectAction: string;
		/** What is being selected: ['internal requirement', 'internal requirements']. */
		noun: [string, string];
	}
	let { id, all, selected = $bindable(), acceptAction, rejectAction, noun }: Props = $props();
	const n = $derived(selected.length);
	let msg = $state<{ ok: boolean; text: string } | null>(null);
	const word = (k: number) => noun[k === 1 ? 0 : 1];
	// Items reviewed one by one meanwhile drop out of the selection.
	$effect.pre(() => {
		const still = selected.filter((v) => all.includes(v));
		if (still.length !== selected.length) selected = still;
	});
</script>

{#if all.length > 1}
	<form
		{id}
		class="au-selectbar"
		class:au-selectbar--active={n > 0}
		method="POST"
		action={acceptAction}
		aria-label="Review selected"
		data-testid="selection-bar"
		use:enhance={({ submitter, cancel }) => {
			const rejecting = submitter?.getAttribute('formaction') === rejectAction;
			if (rejecting && !confirm(`Reject ${n} ${word(n)}?`)) return cancel();
			msg = null;
			return async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') {
					selected = [];
					msg = {
						ok: true,
						text: String((result.data as { success?: string } | undefined)?.success ?? 'Done.')
					};
				} else if (result.type === 'failure') {
					msg = {
						ok: false,
						text: String(
							(result.data as { message?: string } | undefined)?.message ?? 'Could not review the selection.'
						)
					};
				}
			};
		}}
	>
		{#if msg}<span
				class={msg.ok ? 'au-muted' : 'au-field__error'}
				role={msg.ok ? undefined : 'alert'}
				data-testid="selection-result">{msg.text}</span
			>{/if}
		<span class="au-selectbar__count" aria-live="polite"
			>{n ? `${n} of ${all.length} selected` : `Select ${noun[1]} to review them together`}</span
		>
		<span class="au-row au-wrap">
			{#if n < all.length}
				<button class="au-btn au-btn--small au-btn--ghost" type="button" onclick={() => (selected = [...all])}
					>Select all {all.length}</button
				>
			{/if}
			{#if n}
				<button class="au-btn au-btn--small au-btn--ghost" type="button" onclick={() => (selected = [])}
					>Clear selection</button
				>
			{/if}
			<button class="au-btn au-btn--small au-btn--primary" type="submit" disabled={!n}>Accept selected</button
			>
			<button class="au-btn au-btn--small" type="submit" formaction={rejectAction} disabled={!n}
				>Reject selected</button
			>
		</span>
	</form>
{/if}
