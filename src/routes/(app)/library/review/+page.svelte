<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ProposedRequirement from '#lib/components/library/ProposedRequirement.svelte';

	let { data, form } = $props();
	type Result = { message?: string; success?: string; values?: Record<string, string> };
	const result = $derived((form ?? null) as Result | null);
	const errorFor = (id: string) =>
		result?.values?.action === 'edit' && result.values.id === id ? result : null;
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) =>
			update({ reset: false });
	const typeLabel: Record<string, string> = { law: 'Law', standard: 'Standard' };
	// Previews the person opened stay open while they edit (a save reloads the data).
	let opened = $state<Record<string, boolean>>({});
</script>

<svelte:head><title>Review · Library · mcp-audit</title></svelte:head>

<FormMessage form={result} />

{#if data.total === 0}
	<div class="au-empty" data-testid="review-empty">
		<p>
			Nothing waits for review. When Claude imports a source, changes requirements or proposes a mapping, it
			lands here first.
		</p>
		<a class="au-btn" href="/library/import">How to import with Claude</a>
	</div>
{:else}
	<div class="au-proposal">
		<span class="au-proposal__text"
			>{data.total} library {data.total === 1 ? 'change waits' : 'changes wait'} for review</span
		>
		<span class="au-muted">Nothing proposed is used in audits until you accept it.</span>
	</div>
{/if}

{#if data.imports.length}
	<section class="au-section" aria-labelledby="imports-title">
		<h2 class="au-section__title" id="imports-title">Imported sources</h2>
		{#each data.imports as s (s.id)}
			<article class="au-item au-item--proposed" data-testid="import-{s.code}">
				<div class="au-item__head">
					<div>
						<span class="au-ref"
							>{s.code} · {typeLabel[s.type] ?? s.type} · {s.language.toUpperCase()}{s.by
								? ` · ${s.by}`
								: ''}</span
						>
						<h3 class="au-item__title">{s.title}</h3>
					</div>
					<span class="au-badge au-badge--ai">Proposed source</span>
				</div>
				<p class="au-muted">
					{s.requirementCount} requirements, {s.proposedCount} still proposed.{s.licenceNote
						? ` ${s.licenceNote}.`
						: ''}
				</p>
				<div class="au-row au-wrap">
					<form method="POST" action="?/publish" use:enhance={keep}>
						<input type="hidden" name="source" value={s.id} /><button
							class="au-btn au-btn--primary"
							type="submit">Accept all and publish</button
						>
					</form>
					<a class="au-btn" href="/library/mapping?from={encodeURIComponent(s.code)}">Map to another source</a
					>
					<form method="POST" action="?/rejectSource" use:enhance={keep}>
						<input type="hidden" name="source" value={s.id} /><button
							class="au-btn au-btn--ghost"
							type="submit"
							aria-label="Reject source {s.code}">Reject source</button
						>
					</form>
				</div>
				<details
					open={opened[s.id] ?? data.imports.length === 1}
					ontoggle={(ev) => (opened[s.id] = (ev.currentTarget as HTMLDetailsElement).open)}
				>
					<summary>Preview and edit the requirements</summary>
					<ul class="au-list" aria-label="Requirements of {s.title}">
						{#each s.rows as r (r.id)}
							<ProposedRequirement {r} depth={r.depth} error={errorFor(r.id)} />
						{/each}
					</ul>
				</details>
			</article>
		{/each}
	</section>
{/if}

{#if data.changes.length}
	<section class="au-section" aria-labelledby="changes-title">
		<h2 class="au-section__title" id="changes-title">Changes to published sources</h2>
		{#each data.changes as c (c.source.id)}
			<div class="au-row au-between au-wrap">
				<h3 class="au-section__title">{c.source.title}</h3>
				<form method="POST" action="?/acceptAll" use:enhance={keep}>
					<input type="hidden" name="source" value={c.source.id} /><button
						class="au-btn au-btn--small au-btn--primary"
						type="submit"
						aria-label="Accept all changes in {c.source.code}">Accept all</button
					>
				</form>
			</div>
			<ul class="au-list" aria-label="Changes in {c.source.title}">
				{#each c.requirements as r (r.id)}
					<ProposedRequirement {r} before={r.before} by={r.by} error={errorFor(r.id)} />
				{/each}
			</ul>
		{/each}
	</section>
{/if}

{#if data.mappings.length}
	<section class="au-section" aria-labelledby="mappings-title">
		<h2 class="au-section__title" id="mappings-title">Proposed mappings</h2>
		<ul class="au-list">
			{#each data.mappings as m (`${m.fromSourceId}-${m.toSourceId}`)}
				<li class="au-item au-row au-between au-wrap" data-testid="mapping-{m.fromCode}-{m.toCode}">
					<span
						><strong>{m.fromTitle}</strong> → <strong>{m.toTitle}</strong><br /><span class="au-muted"
							>{m.proposed} proposed, {m.confirmed} confirmed links</span
						></span
					>
					<a
						class="au-btn au-btn--primary"
						href="/library/mapping?from={encodeURIComponent(m.fromCode)}&to={encodeURIComponent(m.toCode)}"
						>Review mapping</a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}
