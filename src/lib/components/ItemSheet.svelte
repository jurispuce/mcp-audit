<script lang="ts">
	import { tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { authorship, CHANNEL_LABELS, formatWhen } from '#lib/format.ts';
	import Icon from './Icon.svelte';
	import RequirementDetails from './library/RequirementDetails.svelte';
	import RequirementLinks from './library/RequirementLinks.svelte';
	import type { RequirementExtra } from './library/types';

	/**
	 * The detail view of any record, opened over any screen with `?item=<type>:<id>` (and `&tab=`).
	 * Right-hand panel on desktop, full screen on a phone. Never nests: a linked item replaces the
	 * content and the back arrow returns to the previous one.
	 */

	type Tab = 'details' | 'links' | 'comments' | 'history';
	const TABS: { key: Tab; label: string }[] = [
		{ key: 'details', label: 'Details' },
		{ key: 'links', label: 'Links' },
		{ key: 'comments', label: 'Comments' },
		{ key: 'history', label: 'History' }
	];

	interface SheetData {
		item: {
			type: string;
			id: string;
			label: string;
			refLine: string | null;
			version: number;
			deleted: boolean;
			details: { field: string; label: string; value: string }[];
			lastAuthor: string;
			updatedAt: string;
			counts: { links: number; comments: number; history: number };
			extra: unknown;
		};
		history: {
			version: number;
			createdAt: string;
			authorName: string;
			authorAgent: string | null;
			channel: string;
			note: string | null;
			summary: string;
			isCurrent: boolean;
			changes: { field: string; label: string; from: string; to: string }[];
		}[];
		comments: {
			id: string;
			body: string;
			authorName: string;
			authorAgent: string | null;
			createdAt: string;
		}[];
		links: unknown[];
	}

	const key = $derived(page.url.searchParams.get('item'));
	// Inside an engagement the sheet reads with that engagement's auditee; elsewhere, the shared library.
	const context = $derived.by(() => {
		const e = page.data.engagement as { id: string } | undefined;
		return e ? `?engagement=${encodeURIComponent(e.id)}` : '';
	});
	const tab = $derived((page.url.searchParams.get('tab') as Tab | null) ?? 'details');

	let data = $state<SheetData | null>(null);
	let loadError = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let stack = $state<string[]>([]);
	let draft = $state('');
	let posting = $state(false);
	let heading = $state<HTMLElement | null>(null);

	async function load(k: string) {
		const at = k.indexOf(':');
		const res = await fetch(
			`/api/items/${encodeURIComponent(k.slice(0, at))}/${encodeURIComponent(k.slice(at + 1))}${context}`
		);
		if (key !== k) return;
		if (!res.ok) {
			data = null;
			loadError =
				res.status === 404
					? 'This item does not exist.'
					: res.status === 403
						? 'This item belongs to another auditee and cannot be opened here.'
						: 'The item could not be loaded.';
			return;
		}
		data = (await res.json()) as SheetData;
		loadError = null;
	}

	$effect(() => {
		const k = key;
		actionError = null;
		if (!k) {
			data = null;
			loadError = null;
			return;
		}
		load(k).then(async () => {
			await tick();
			heading?.focus();
		});
	});

	/** Reload the sheet after a change made inside it, and the screen underneath. */
	async function reload() {
		if (key) await load(key);
		await invalidateAll();
	}

	function urlWith(changes: Record<string, string | null>) {
		const url = new URL(page.url.href);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		return url.pathname + url.search + url.hash;
	}

	function close() {
		stack = [];
		goto(urlWith({ item: null, tab: null }), { reset: false });
	}

	function back() {
		const previous = stack.pop();
		if (previous) goto(urlWith({ item: previous, tab: null }), { reset: false });
		else close();
	}

	/** Open a linked item inside the sheet: replaces the content, back returns here. */
	export function openLinked(next: string) {
		if (key) stack.push(key);
		goto(urlWith({ item: next, tab: null }), { reset: false });
	}

	function setTab(t: Tab) {
		goto(urlWith({ tab: t === 'details' ? null : t }), { replace: true, reset: false });
	}

	async function revert(version: number) {
		if (!data) return;
		const next = data.item.version + 1;
		if (
			!confirm(
				`Revert to version ${version}? This creates version ${next} as a copy of version ${version}; nothing is lost.`
			)
		)
			return;
		const res = await fetch(`/api/items/${data.item.type}/${data.item.id}/revert${context}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ toVersion: version, baseVersion: data.item.version })
		});
		if (!res.ok) {
			actionError = ((await res.json()) as { message?: string }).message ?? 'Revert failed.';
			if (res.status === 409 && key) await load(key);
			return;
		}
		actionError = null;
		if (key) await load(key);
		await invalidateAll();
	}

	async function addComment(e: SubmitEvent) {
		e.preventDefault();
		if (!data || !draft.trim()) return;
		posting = true;
		const res = await fetch(`/api/items/${data.item.type}/${data.item.id}/comments${context}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ body: draft })
		});
		posting = false;
		if (!res.ok) {
			actionError = ((await res.json()) as { message?: string }).message ?? 'The comment was not saved.';
			return;
		}
		draft = '';
		actionError = null;
		if (key) await load(key);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && key) close();
	}

	const count = (t: Tab) =>
		data
			? t === 'links'
				? data.item.counts.links
				: t === 'comments'
					? data.item.counts.comments
					: t === 'history'
						? data.item.counts.history
						: 0
			: 0;
</script>

<svelte:window {onkeydown} />

{#if key}
	<button class="au-overlay" type="button" aria-label="Close item" tabindex="-1" onclick={close}></button>
	<div
		class="au-sheet"
		role="dialog"
		aria-modal="true"
		aria-labelledby="sheet-title"
		data-testid="item-sheet"
	>
		<div class="au-sheet__bar">
			<button
				class="au-btn au-btn--ghost"
				type="button"
				onclick={back}
				aria-label={stack.length ? 'Back' : 'Close'}
			>
				<Icon name={stack.length ? 'back' : 'close'} />{stack.length ? 'Back' : 'Close'}
			</button>
		</div>

		{#if loadError}
			<div class="au-alert au-alert--danger" role="alert">{loadError}</div>
		{:else if !data}
			<p class="au-muted">Loading…</p>
		{:else}
			<div class="au-sheet__head">
				<div>
					{#if data.item.refLine}<span class="au-ref">{data.item.refLine}</span>{/if}
					<h2 class="au-sheet__title" id="sheet-title" tabindex="-1" bind:this={heading}>
						{data.item.label}
					</h2>
				</div>
				{#if data.item.deleted}<span class="au-badge au-badge--danger">Deleted</span>{/if}
			</div>
			<p class="au-muted">
				<span class="au-ref">v{data.item.version}</span> · {data.item.lastAuthor} · {formatWhen(
					data.item.updatedAt
				)}
			</p>

			<div class="au-tabs" role="tablist" aria-label="Item">
				{#each TABS as t (t.key)}
					<button
						class="au-tab"
						type="button"
						role="tab"
						id="tab-{t.key}"
						aria-selected={tab === t.key}
						aria-controls="panel-{t.key}"
						onclick={() => setTab(t.key)}
					>
						{t.label}{#if count(t.key)}<span class="au-tab__count">{count(t.key)}</span>{/if}
					</button>
				{/each}
			</div>

			{#if actionError}<div class="au-alert au-alert--danger" role="alert">{actionError}</div>{/if}

			<div role="tabpanel" id="panel-{tab}" aria-labelledby="tab-{tab}">
				{#if tab === 'details'}
					<dl class="au-dl">
						{#each data.item.details as d (d.field)}
							<dt>{d.label}</dt>
							<dd>{d.value || '—'}</dd>
						{/each}
					</dl>
					{#if data.item.type === 'requirement' && data.item.extra}
						<RequirementDetails
							extra={data.item.extra as RequirementExtra}
							onchange={reload}
							onopen={openLinked}
						/>
					{/if}
				{:else if tab === 'links'}
					{#if data.item.type === 'requirement' && data.item.extra}
						<RequirementLinks
							extra={data.item.extra as RequirementExtra}
							onchange={reload}
							onopen={openLinked}
						/>
					{:else}
						<div class="au-empty">Nothing is linked to this item yet.</div>
					{/if}
				{:else if tab === 'comments'}
					{#if data.comments.length === 0}
						<p class="au-muted">No comments yet.</p>
					{:else}
						<ul class="au-comments">
							{#each data.comments as c (c.id)}
								<li class="au-comment" class:au-comment--ai={!!c.authorAgent}>
									<span class="au-muted"
										>{authorship(c.authorName, c.authorAgent)} · {formatWhen(c.createdAt)}</span
									>
									<p class="au-comment__body">{c.body}</p>
								</li>
							{/each}
						</ul>
					{/if}
					<form class="au-stack" onsubmit={addComment}>
						<div class="au-field">
							<label for="comment-body">Comment</label>
							<textarea id="comment-body" name="body" bind:value={draft} maxlength="10000" required
							></textarea>
						</div>
						<div>
							<button class="au-btn au-btn--primary" type="submit" disabled={posting || !draft.trim()}
								>Add comment</button
							>
						</div>
						<p class="au-muted">Comments cannot be edited or deleted.</p>
					</form>
				{:else if tab === 'history'}
					<ul class="au-history" data-testid="history">
						{#each data.history as h (h.version)}
							<li data-version={h.version}>
								<div class="au-history__what">
									<span><span class="au-ref">v{h.version}</span> · {h.summary}</span>
									{#if h.note}<span data-testid="history-note">{h.note}</span>{/if}
									{#each h.changes as c (c.field)}
										<span class="au-muted">
											{c.label}:
											{#if c.from}<span class="au-diff-del">{c.from}</span>{/if}
											{#if c.to}<span class="au-diff-ins">{c.to}</span>{/if}
										</span>
									{/each}
									<span class="au-muted">
										{authorship(h.authorName, h.authorAgent)} · {formatWhen(h.createdAt)} · {CHANNEL_LABELS[
											h.channel
										] ?? h.channel}{#if h.isCurrent}&nbsp;· current{/if}
									</span>
								</div>
								{#if !h.isCurrent}
									<button
										class="au-btn au-btn--small au-btn--danger"
										type="button"
										onclick={() => revert(h.version)}
									>
										Revert
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
{/if}
