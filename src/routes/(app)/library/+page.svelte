<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import type { TreeNode } from '#lib/domain/library.ts';

	let { data, form } = $props();
	let importing = $state(false);

	/** Keep the current query string (source, q) and open an item over it. */
	function itemHref(id: string) {
		const keep = ['source', 'q']
			.map((k) => [k, page.url.searchParams.get(k)] as const)
			.filter(([, v]) => v)
			.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
		return `?${[...keep, `item=requirement:${id}`].join('&')}`;
	}
	const openItem = $derived(page.url.searchParams.get('item'));
	const typeLabel: Record<string, string> = { law: 'Law', standard: 'Standard', internal: 'Internal' };

	/** Highlight the matched words FTS marked with [ ]. Text is escaped first. */
	function snippet(s: string) {
		const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return esc.replace(/\[([^\]]*)\]/g, '<mark>$1</mark>');
	}
</script>

<svelte:head><title>Library · mcp-audit</title></svelte:head>

{#snippet node(n: TreeNode)}
	<li>
		<a
			class="au-tree__row"
			href={itemHref(n.id)}
			data-sveltekit-reset="false"
			aria-current={openItem === `requirement:${n.id}` ? 'true' : undefined}
		>
			<span class="au-ref">{n.refCode}</span><span>{n.title}</span>
		</a>
		{#if n.children.length}
			<ul>
				{#each n.children as c (c.id)}{@render node(c)}{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<section class="au-screen">
	<header class="au-screen__head">
		<h1 class="au-screen__title">Library</h1>
		{#if !importing}<button class="au-btn" type="button" onclick={() => (importing = true)}
				>Import source</button
			>{/if}
	</header>

	{#if form?.report}
		{@const r = form.report}
		<div class="au-alert au-alert--ok" role="status" data-testid="import-report">
			<p class="au-alert__title">{r.source.created ? 'Imported' : 'Updated'} {r.source.title}</p>
			<p>
				{r.requirements.created} new, {r.requirements.updated} changed, {r.requirements.restored} restored,
				{r.requirements.unchanged} unchanged requirements. {r.links.created} links, {r.guidance.created +
					r.guidance.updated}
				guidance and {r.criteria.created} criteria added or changed.
			</p>
			{#if r.notInFile.length}
				<p>Not in the file, left as they were: {r.notInFile.join(', ')}.</p>
			{/if}
			{#if r.warnings.length}
				<ul>
					{#each r.warnings as w, i (i)}<li>{w}</li>{/each}
				</ul>
			{/if}
			<div>
				<a class="au-btn" href="?source={encodeURIComponent(r.source.code)}">Open {r.source.title}</a>
			</div>
		</div>
	{:else}
		<FormMessage {form} />
	{/if}

	{#if importing}
		<form
			method="POST"
			action="?/import"
			enctype="multipart/form-data"
			class="au-item au-stack"
			use:enhance={() =>
				async ({ update, result }) => {
					await update();
					if (result.type === 'success') importing = false;
				}}
		>
			<h2 class="au-section__title">Import a source</h2>
			<p class="au-muted">
				A YAML file in the shape the audit skills use: <span class="au-ref"
					>id, title, type, language, licence_note, requirements</span
				>. Importing the same file again changes nothing; changed requirements become new versions.
			</p>
			<div class="au-field">
				<label for="import-file">YAML file</label>
				<input id="import-file" type="file" name="file" accept=".yaml,.yml,text/yaml" />
			</div>
			<div class="au-field">
				<label for="import-yaml">Or paste the YAML</label>
				<textarea id="import-yaml" name="yaml" rows="6"></textarea>
			</div>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit">Import source</button>
				<button class="au-btn au-btn--ghost" type="button" onclick={() => (importing = false)}>Cancel</button>
			</div>
		</form>
	{/if}

	<form method="GET" class="au-row" role="search">
		{#if data.source}<input type="hidden" name="source" value={data.source.code} />{/if}
		<div class="au-field au-grow">
			<label for="library-q">Search requirements{data.source ? ` in ${data.source.title}` : ''}</label>
			<input id="library-q" name="q" type="search" defaultValue={data.q} placeholder="Code, title or text" />
		</div>
		<button class="au-btn" type="submit" style="align-self: flex-end">Search</button>
	</form>

	{#if data.q}
		<section class="au-section" aria-label="Search results" data-testid="search-results">
			<p class="au-muted">
				{data.results.length}
				{data.results.length === 1 ? 'requirement' : 'requirements'} match "{data.q}".
			</p>
			<ul class="au-list">
				{#each data.results as r (r.id)}
					<li class="au-item">
						<span class="au-ref">{r.refCode} · {r.sourceCode} · {r.language.toUpperCase()}</span>
						<h3 class="au-item__title">
							<a href={itemHref(r.id)} data-sveltekit-reset="false">{r.title}</a>
						</h3>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- snippet text is escaped above -->
						<p class="au-snippet">{@html snippet(r.snippet)}</p>
					</li>
				{/each}
			</ul>
		</section>
	{:else if data.source}
		<section class="au-section" aria-labelledby="source-title" data-testid="source-tree">
			<div><a class="au-btn au-btn--ghost" href="/library">All sources</a></div>
			<h2 class="au-section__title" id="source-title">{data.source.title}</h2>
			<p class="au-muted">
				{typeLabel[data.source.type] ?? data.source.type} · {data.source.language.toUpperCase()}{data.source
					.edition
					? ` · ${data.source.edition}`
					: ''} · {data.source.requirementCount} requirements{data.source.licenceNote
					? ` · ${data.source.licenceNote}`
					: ''}
			</p>
			{#if data.tree.length === 0}
				<div class="au-empty">This source has no requirements.</div>
			{:else}
				<ul class="au-tree">
					{#each data.tree as n (n.id)}{@render node(n)}{/each}
				</ul>
			{/if}
		</section>
	{:else}
		<section class="au-section" aria-label="Sources">
			{#if data.sources.length === 0}
				<div class="au-empty" data-testid="library-empty">
					<p>The library is empty. Start with NIS 2 Article 21, or import your own source file.</p>
				</div>
			{:else}
				<ul class="au-list" data-testid="sources">
					{#each data.sources as s (s.id)}
						<li class="au-item">
							<div class="au-item__head">
								<div>
									<span class="au-ref"
										>{s.code}{s.edition ? ` · ${s.edition}` : ''} · {s.language.toUpperCase()}</span
									>
									<h3 class="au-item__title"><a href="?source={encodeURIComponent(s.code)}">{s.title}</a></h3>
								</div>
								<span class="au-badge">{typeLabel[s.type] ?? s.type}</span>
							</div>
							<div class="au-item__meta">
								<span>{s.requirementCount} requirements</span><span class="au-ref">v{s.version}</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			{#each data.bundled as b (b.file)}
				<form method="POST" action="?/bundled" use:enhance class="au-row">
					<input type="hidden" name="file" value={b.file} />
					<button class="au-btn {data.sources.length ? '' : 'au-btn--primary'}" type="submit"
						>Import {b.title}</button
					>
					<span class="au-muted">Bundled with the app · {b.requirements} requirements</span>
				</form>
			{/each}
		</section>
	{/if}
</section>
