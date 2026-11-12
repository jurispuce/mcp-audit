<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import FindingList from '#lib/components/findings/FindingList.svelte';

	let { data, form } = $props();
	type Result = { message?: string; success?: string; exported?: { id: string; filename: string } };
	const result = $derived((form ?? null) as Result | null);
	const base = $derived(`/e/${data.engagement.id}`);
	const r = $derived(data.report);
</script>

<svelte:head><title>Conclusions · Findings · mcp-audit</title></svelte:head>

<FormMessage form={result} />
{#if result?.exported}<p>
		<a class="au-btn" href="{base}/documents/{result.exported.id}/file" download data-testid="download-report"
			>Download {result.exported.filename}</a
		>
	</p>{/if}

<section class="au-section" aria-labelledby="report-title">
	<div class="au-row au-between au-wrap">
		<h2 class="au-section__title" id="report-title">Findings report</h2>
		<form
			method="POST"
			action="?/export"
			class="au-row au-wrap"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<input type="hidden" name="drafts" value={data.includeDrafts ? '1' : ''} />
			<button class="au-btn au-btn--primary" type="submit" name="format" value="docx"
				>Export report as DOCX</button
			>
			<button class="au-btn" type="submit" name="format" value="pdf">Export report as PDF</button>
		</form>
	</div>
	<p class="au-muted">
		{r.approved} of {r.units} assessment units are approved conclusions{r.drafts
			? `; ${r.drafts} drafts are not in the report`
			: ''}. In the report language ({r.language.toUpperCase()}); suspected issues and criticality are never
		included.
	</p>
	<a
		class="au-btn au-btn--small"
		href={data.includeDrafts ? '?' : '?drafts=1'}
		aria-current={data.includeDrafts ? 'true' : undefined}
		>{data.includeDrafts ? 'Approved findings only' : 'Include drafts (marked DRAFT)'}</a
	>
	{#if !r.translated}<div class="au-alert au-alert--warn">
			The template has no {r.language.toUpperCase()} version yet, so its headings are in English.
		</div>{/if}
	<details class="au-item">
		<summary>Preview</summary>
		<article class="au-doc" data-testid="report-preview">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html r.html}
		</article>
	</details>
	{#if data.exports.length}
		<ul class="au-list" aria-label="Earlier reports">
			{#each data.exports as x (x.id)}
				<li class="au-row au-between">
					<span>{x.filename}</span><a
						class="au-btn au-btn--small"
						href="{base}/documents/{x.id}/file"
						download>Download</a
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="au-section" aria-labelledby="conclusions-title">
	<h2 class="au-section__title" id="conclusions-title">Conclusions</h2>
	{#if data.cards.length}
		<FindingList
			cards={data.cards}
			scale={data.scale}
			multipleScopes={data.engagement.scopeMode === 'multiple'}
			form={form as never}
			label="Conclusions"
		/>
	{:else}
		<div class="au-empty"><p>No approved findings yet.</p></div>
	{/if}
</section>
