<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';

	let { data, form } = $props();
	const e = $derived(data.engagement);
	const base = $derived(`/e/${e.id}`);
	const FILTERS = [
		{ key: null, label: 'All' },
		{ key: 'role', label: 'Roles' },
		{ key: 'internal', label: 'Internal requirements' },
		{ key: 'event', label: 'Events' },
		{ key: 'evidence', label: 'Evidence' },
		{ key: 'link', label: 'Evidence links' },
		{ key: 'finding', label: 'Findings' }
	] as const;
	const TYPE_LABEL: Record<string, string> = {
		role: 'Role',
		internal: 'Internal requirement',
		event: 'Drafted event',
		evidence: 'Planned evidence',
		link: 'Evidence link',
		finding: 'Finding'
	};
	const counts = $derived(
		data.proposals.byType as Record<string, { count: number; sources: string[] } | undefined>
	);
	const STATUS: Record<string, { label: string; tone: 'ok' | 'info' | 'danger' | 'neutral' }> = {
		running: { label: 'Running', tone: 'info' },
		succeeded: { label: 'Done', tone: 'ok' },
		failed: { label: 'Failed', tone: 'danger' },
		cancelled: { label: 'Cancelled', tone: 'neutral' }
	};
	const keep = () => {
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
		};
	};
</script>

<svelte:head><title>Proposals · {e.name} · mcp-audit</title></svelte:head>

<section class="au-screen">
	<header class="au-screen__head">
		<span class="au-ref">Review</span>
		<h1 class="au-screen__title">Proposals</h1>
	</header>
	<p class="au-muted">
		What AI proposed and nobody has reviewed yet, from the in-app AI buttons or from Claude through MCP.
		Accept, edit or reject each; accepting a finding makes it a draft, and approving it stays a separate step
		on Findings.
	</p>

	<nav class="au-tabbar" aria-label="Proposal type">
		{#each FILTERS as f (f.key ?? 'all')}
			{@const n = f.key ? (counts[f.key]?.count ?? 0) : data.proposals.count}
			<a
				href={f.key ? `?type=${f.key}` : '?'}
				aria-current={data.type === f.key ? 'page' : undefined}
				data-sveltekit-noscroll>{f.label}{n ? ` (${n})` : ''}</a
			>
		{/each}
	</nav>

	<FormMessage {form} />

	{#if data.items.length === 0}
		<div class="au-empty" data-testid="no-proposals">
			<p>Nothing waits for review{data.type ? ' here' : ''}.</p>
		</div>
	{:else}
		<div class="au-proposal">
			<span class="au-proposal__text"
				>{data.items.length} {data.items.length === 1 ? 'proposal waits' : 'proposals wait'} for review</span
			>
			<form method="POST" action="?/acceptAll" use:enhance={keep}>
				{#if data.type}<input type="hidden" name="type" value={data.type} />{/if}
				<button class="au-btn au-btn--small au-btn--primary" type="submit">Accept all</button>
			</form>
		</div>
		<ul class="au-list" aria-label="Proposals">
			{#each data.items as p (`${p.type}:${p.id}`)}
				<li>
					<ItemCard
						state="proposed"
						ref="{TYPE_LABEL[p.type]} · from {p.source}"
						title={p.title}
						href="?item={p.entityType}:{p.id}"
						body={p.detail}
						version={p.version}
						testid="proposal-{p.type}-{p.title}"
					>
						{#snippet actions()}
							<form method="POST" action="?/accept" use:enhance={keep}>
								<input type="hidden" name="type" value={p.type} />
								<input type="hidden" name="id" value={p.id} />
								<button
									class="au-btn au-btn--small au-btn--primary"
									type="submit"
									aria-label="Accept {p.title}">Accept</button
								>
							</form>
							<a class="au-btn au-btn--small au-btn--ghost" href="{base}{p.path}" aria-label="Edit {p.title}"
								>Edit</a
							>
							<form method="POST" action="?/reject" use:enhance={keep}>
								<input type="hidden" name="type" value={p.type} />
								<input type="hidden" name="id" value={p.id} />
								<button class="au-btn au-btn--small au-btn--ghost" type="submit" aria-label="Reject {p.title}"
									>Reject</button
								>
							</form>
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{/if}

	<section class="au-section" aria-labelledby="jobs-title">
		<h2 class="au-section__title" id="jobs-title">Recent AI actions</h2>
		{#if data.jobs.length === 0}
			<div class="au-empty"><p>No in-app AI action has run on this engagement.</p></div>
		{:else}
			<ul class="au-list" aria-label="Recent AI actions">
				{#each data.jobs as j (j.id)}
					<li>
						<ItemCard
							title={j.label}
							ref="{j.model} · started by {j.userName}"
							badge={STATUS[j.status]}
							body={j.error ?? j.summary}
							at={j.createdAt}
							testid="job-{j.action}"
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</section>
