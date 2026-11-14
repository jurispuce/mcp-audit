<script lang="ts">
	/**
	 * Two requirements in full, next to each other (stacked on a phone), to judge a mapping: the
	 * requirement being mapped on the left, the one in the target source on the right. Texts load
	 * when the panel opens.
	 */
	interface Props {
		leftId: string;
		rightId: string;
		/** What the link says, shown between the two, for example "Implements, partial coverage". */
		relation?: string | null;
		reason?: string | null;
	}
	let { leftId, rightId, relation = null, reason = null }: Props = $props();

	type Req = {
		id: string;
		refCode: string;
		title: string;
		text: string | null;
		sourceTitle: string;
		locator: string | null;
		path: { refCode: string; title: string }[];
		guidance: string | null;
	};
	/** Loaded once per requirement shown: the derived values below re-run only when an id changes. */
	async function load(id: string): Promise<Req> {
		const r = await fetch(`/api/library/requirements/${encodeURIComponent(id)}`);
		const body = await r.json().catch(() => ({}));
		if (!r.ok) throw new Error(body.message ?? `Could not load the requirement (${r.status}).`);
		return body.requirement as Req;
	}
	const left = $derived(load(leftId));
	const right = $derived(load(rightId));
</script>

{#snippet side(p: Promise<Req>, label: string)}
	<section class="au-compare__side" aria-label={label}>
		{#await p}
			<p class="au-muted">Loading…</p>
		{:then r}
			<span class="au-ref">{r.sourceTitle}{r.locator ? ` · ${r.locator}` : ''}</span>
			{#if r.path.length}
				<p class="au-compare__path">{r.path.map((x) => `${x.refCode} ${x.title}`).join(' › ')}</p>
			{/if}
			<h4 class="au-compare__title"><span class="au-ref">{r.refCode}</span> {r.title}</h4>
			{#if r.text}
				<p class="au-compare__text">{r.text}</p>
			{:else}
				<p class="au-muted">
					No text stored, only the reference and title (for example for a licensed standard).
				</p>
			{/if}
			{#if r.guidance}
				<details>
					<summary>Audit guidance</summary>
					<p class="au-compare__text">{r.guidance}</p>
				</details>
			{/if}
		{:catch e}
			<p class="au-field__error" role="alert">{e.message}</p>
		{/await}
	</section>
{/snippet}

<div class="au-compare" data-testid="compare">
	{@render side(left, 'Requirement being mapped')}
	<div class="au-compare__relation" aria-label="Link">
		{#if relation}<strong>{relation}</strong>{/if}
		{#if reason}<span class="au-muted">Reason: {reason}</span>{/if}
	</div>
	{@render side(right, 'Requirement in the target source')}
</div>
