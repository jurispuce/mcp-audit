<script lang="ts">
	import { enhance } from '$app/forms';

	/** One proposed requirement in review: what it says (and what it said before), edit, accept, reject. */
	interface Props {
		r: {
			id: string;
			refCode: string;
			title: string;
			text: string | null;
			version: number;
			status: string;
			parentRef?: string | null;
		};
		before?: { title: string; text: string | null; refCode: string } | null;
		depth?: number;
		by?: string | null;
		error?: { message?: string; values?: Record<string, string> } | null;
	}
	let { r, before = null, depth = 0, by = null, error = null }: Props = $props();
	let editing = $state(false);
	const open = $derived(editing || !!error);
	const v = $derived(error?.values ?? {});
	const keep =
		() =>
		async ({
			update,
			result
		}: {
			update: (o?: { reset?: boolean }) => Promise<void>;
			result: { type: string };
		}) => {
			await update({ reset: false });
			if (result.type === 'success') editing = false;
		};
	const p = $derived(`pr-${r.id.slice(0, 8)}`);
</script>

<li
	class="au-item"
	class:au-item--proposed={r.status === 'proposed'}
	style:margin-left="{depth * 1.25}rem"
	data-testid="proposed-{r.refCode}"
	data-state={r.status}
>
	<div class="au-item__head">
		<div>
			<span class="au-ref">{r.refCode}{by ? ` · ${by}` : ''}</span>
			<h3 class="au-item__title">
				<a class="au-titlelink" href="?item=requirement:{r.id}" data-sveltekit-reset="false">{r.title}</a>
			</h3>
		</div>
		{#if r.status === 'proposed'}<span class="au-badge au-badge--ai">Proposed</span>{:else}<span
				class="au-badge au-badge--ok">Accepted</span
			>{/if}
	</div>
	{#if before && (before.title !== r.title || before.text !== r.text || before.refCode !== r.refCode)}
		<p class="au-muted">
			Was: {#if before.refCode !== r.refCode}<span class="au-diff-del">{before.refCode}</span>
			{/if}{#if before.title !== r.title}<span class="au-diff-del">{before.title}</span>{/if}
			{#if before.text !== r.text}<br /><span class="au-diff-del">{before.text ?? '(no text)'}</span> →
				<span class="au-diff-ins">{r.text ?? '(no text)'}</span>{/if}
		</p>
	{:else if r.text}
		<p class="au-item__body">{r.text}</p>
	{/if}
	{#if error?.message}<div class="au-alert au-alert--danger" role="alert">{error.message}</div>{/if}
	<div class="au-item__actions">
		{#if open}
			<form method="POST" action="?/edit" class="au-form au-grow" use:enhance={keep}>
				<input type="hidden" name="id" value={r.id} />
				<input type="hidden" name="base_version" value={r.version} />
				<div class="au-row au-wrap">
					<div class="au-field">
						<label for="{p}-ref">Reference</label><input
							id="{p}-ref"
							name="ref_code"
							defaultValue={v.ref_code ?? r.refCode}
							required
						/>
					</div>
					<div class="au-field">
						<label for="{p}-parent">Parent (reference)</label><input
							id="{p}-parent"
							name="parent"
							defaultValue={v.parent ?? r.parentRef ?? ''}
						/>
					</div>
				</div>
				<div class="au-field">
					<label for="{p}-title">Title</label><input
						id="{p}-title"
						name="title"
						defaultValue={v.title ?? r.title}
						required
					/>
				</div>
				<div class="au-field">
					<label for="{p}-text">Text</label><textarea
						id="{p}-text"
						name="text"
						rows="3"
						defaultValue={v.text ?? r.text ?? ''}></textarea>
				</div>
				<div class="au-row">
					<button class="au-btn au-btn--primary au-btn--small" type="submit">Save changes</button>
					<button class="au-btn au-btn--ghost au-btn--small" type="button" onclick={() => (editing = false)}
						>Cancel</button
					>
				</div>
			</form>
		{:else if r.status === 'proposed'}
			<div class="au-row au-wrap">
				<form method="POST" action="?/accept" use:enhance={keep}>
					<input type="hidden" name="id" value={r.id} /><button
						class="au-btn au-btn--small au-btn--primary"
						type="submit"
						aria-label="Accept {r.refCode}">Accept</button
					>
				</form>
				<button
					class="au-btn au-btn--small"
					type="button"
					onclick={() => (editing = true)}
					aria-label="Edit {r.refCode}">Edit</button
				>
				<form method="POST" action="?/reject" use:enhance={keep}>
					<input type="hidden" name="id" value={r.id} /><button
						class="au-btn au-btn--small au-btn--ghost"
						type="submit"
						aria-label="Reject {r.refCode}">Reject</button
					>
				</form>
			</div>
		{/if}
	</div>
</li>
