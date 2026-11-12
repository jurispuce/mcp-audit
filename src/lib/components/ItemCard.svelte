<script lang="ts">
	import type { Snippet } from 'svelte';
	import { authorship, formatWhen } from '#lib/format.ts';

	/**
	 * The one pattern for every record: reference line, title and state badge, body, meta row, actions.
	 * Tapping the title opens the item sheet (`href` is usually `?item=<type>:<id>`).
	 */
	interface Props {
		ref?: string | null;
		title: string;
		href?: string;
		state?: 'default' | 'proposed' | 'locked';
		badge?: { label: string; tone?: 'ok' | 'info' | 'warn' | 'danger' | 'ai' | 'neutral' } | null;
		body?: string | null;
		version?: number;
		author?: string;
		agent?: string | null;
		at?: Date | string | number;
		meta?: Snippet;
		actions?: Snippet;
		testid?: string;
	}
	let {
		ref,
		title,
		href,
		state = 'default',
		badge,
		body,
		version,
		author,
		agent,
		at,
		meta,
		actions,
		testid
	}: Props = $props();

	const by = $derived(author ? authorship(author, state === 'proposed' ? (agent ?? 'Claude') : agent) : null);
</script>

<article
	class="au-item"
	class:au-item--proposed={state === 'proposed'}
	class:au-item--locked={state === 'locked'}
	data-state={state}
	data-testid={testid}
>
	<div class="au-item__head">
		<div>
			{#if ref}<span class="au-ref">{ref}</span>{/if}
			<h3 class="au-item__title">
				{#if href}<a {href} data-sveltekit-reset="false">{title}</a>{:else}{title}{/if}
			</h3>
		</div>
		<div class="au-row">
			{#if state === 'proposed'}
				<span class="au-badge au-badge--ai">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /></svg
					>Proposed by AI
				</span>
			{/if}
			{#if state === 'locked'}
				<span class="au-badge au-badge--ok">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11h12v9H6zM9 11V8a3 3 0 016 0v3" /></svg
					>Approved
				</span>
			{:else if badge}
				<span class="au-badge {badge.tone && badge.tone !== 'neutral' ? `au-badge--${badge.tone}` : ''}"
					>{badge.label}</span
				>
			{/if}
		</div>
	</div>
	{#if body}<p class="au-item__body">{body}</p>{/if}
	<div class="au-item__meta">
		{#if version !== undefined}<span class="au-ref">v{version}</span>{/if}
		{#if by}<span
				>{by}{#if at}&nbsp;· {formatWhen(at)}{/if}</span
			>{/if}
		{@render meta?.()}
	</div>
	{#if actions}
		<div class="au-item__actions">{@render actions()}</div>
	{/if}
</article>
