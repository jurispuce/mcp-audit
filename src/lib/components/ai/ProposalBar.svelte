<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	/**
	 * Unreviewed AI proposals on this screen: how many, from which action, and the way to the review
	 * list. Reads the engagement's proposal summary from the layout data, so it disappears when the last
	 * proposal of its types is accepted or rejected.
	 */
	type Type = 'role' | 'internal' | 'event' | 'evidence' | 'link' | 'finding';
	interface Props {
		types: Type[];
		/** The screen's own Accept all control; without it the bar accepts through the review list. */
		children?: Snippet;
		testid?: string;
	}
	let { types, children, testid = 'proposal-bar' }: Props = $props();

	const LABELS: Record<Type, [string, string]> = {
		role: ['role', 'roles'],
		internal: ['internal requirement', 'internal requirements'],
		event: ['drafted event', 'drafted events'],
		evidence: ['planned evidence item', 'planned evidence items'],
		link: ['evidence link', 'evidence links'],
		finding: ['finding', 'findings']
	};

	type Summary = { count: number; byType: Record<Type, { count: number; sources: string[] }> };
	const summary = $derived(page.data.proposals as Summary | undefined);
	const engagementId = $derived((page.data.engagement as { id: string } | undefined)?.id);
	const parts = $derived(
		types.map((t) => ({ t, ...(summary?.byType[t] ?? { count: 0, sources: [] }) })).filter((p) => p.count > 0)
	);
	const count = $derived(parts.reduce((n, p) => n + p.count, 0));
	const sources = $derived([...new Set(parts.flatMap((p) => p.sources))]);
	const what = $derived(parts.map((p) => `${p.count} ${LABELS[p.t][p.count === 1 ? 0 : 1]}`).join(', '));
	const reviewHref = $derived(`/e/${engagementId}/proposals${types.length === 1 ? `?type=${types[0]}` : ''}`);
</script>

{#if engagementId && count > 0}
	<div class="au-proposal" data-testid={testid} role="region" aria-label="AI proposals">
		<span class="au-proposal__text">{what} proposed from {sources.map((s) => `“${s}”`).join(' and ')}</span>
		<span class="au-row">
			<a class="au-btn au-btn--small" href={reviewHref}>Review</a>
			{#if children}
				{@render children()}
			{:else}
				<form method="POST" action="/e/{engagementId}/proposals?/acceptAll" use:enhance>
					{#each types as t (t)}<input type="hidden" name="type" value={t} />{/each}
					<button class="au-btn au-btn--small au-btn--ghost" type="submit">Accept all</button>
				</form>
			{/if}
		</span>
	</div>
{/if}
