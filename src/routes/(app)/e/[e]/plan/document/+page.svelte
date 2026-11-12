<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import PlanHeader from '#lib/components/plan/PlanHeader.svelte';
	import { formatWhen } from '#lib/format.ts';

	let { data, form } = $props();
	type Result = { message?: string; success?: string; exported?: { id: string; filename: string } };
	const result = $derived((form ?? null) as Result | null);
	const d = $derived(data.document);
	const base = $derived(`/e/${data.engagement.id}`);
	let busy = $state<string | null>(null);
</script>

<svelte:head><title>Audit plan · Plan · mcp-audit</title></svelte:head>

<PlanHeader plan={data.plan} engagement={data.engagement} />
<FormMessage form={result} />
{#if result?.exported}
	<p>
		<a class="au-btn" href="{base}/documents/{result.exported.id}/file" download data-testid="download-export"
			>Download {result.exported.filename}</a
		>
	</p>
{/if}

<section class="au-section" aria-labelledby="export-title">
	<div class="au-row au-between au-wrap">
		<h2 class="au-section__title" id="export-title">Export</h2>
		<form
			method="POST"
			action="?/export"
			class="au-row"
			use:enhance={({ submitter }) => {
				busy = submitter?.getAttribute('value') ?? 'docx';
				return async ({ update }) => {
					await update({ reset: false });
					busy = null;
				};
			}}
		>
			<button class="au-btn au-btn--primary" type="submit" name="format" value="docx" disabled={!!busy}
				>{busy === 'docx' ? 'Exporting…' : 'Export plan as DOCX'}</button
			>
			<button class="au-btn" type="submit" name="format" value="pdf" disabled={!!busy}
				>{busy === 'pdf' ? 'Exporting…' : 'Export plan as PDF'}</button
			>
		</form>
	</div>
	<p class="au-muted">
		In the report language ({d.language.toUpperCase()}). The export holds events, times, participants,
		requirements and what to prepare; never criticality, risks or your reasoning. Each export is kept with the
		engagement's documents.
	</p>
	{#if !d.translated}
		<div class="au-alert au-alert--warn">
			The template has no {d.language.toUpperCase()} version yet, so its headings are in English. Your content is
			shown as written.
		</div>
	{/if}
	{#if d.uncovered.length}
		<div class="au-alert au-alert--warn" data-testid="uncovered">
			<p class="au-alert__title">
				{d.uncovered.length} selected {d.uncovered.length === 1 ? 'requirement is' : 'requirements are'} in no event
			</p>
			<p>{d.uncovered.join(', ')}</p>
			<a class="au-btn au-btn--small" href="{base}/plan/coverage?uncovered=1">Open coverage</a>
		</div>
	{/if}
	{#if d.drafts}
		<div class="au-alert au-alert--info">
			{d.drafts} drafted {d.drafts === 1 ? 'event is' : 'events are'} left out until accepted on
			<a href="{base}/plan/events">Events</a>.
		</div>
	{/if}
</section>

<section class="au-section" aria-labelledby="preview-title">
	<h2 class="au-section__title" id="preview-title">Preview</h2>
	<article class="au-item au-doc" data-testid="plan-preview">
		<!-- Rendered from the same Markdown as the export; user text is escaped before rendering. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html d.html}
	</article>
</section>

{#if data.exports.length}
	<section class="au-section" aria-labelledby="exports-title">
		<h2 class="au-section__title" id="exports-title">Earlier exports</h2>
		<ul class="au-list" aria-label="Earlier exports">
			{#each data.exports as x (x.id)}
				<li class="au-row au-between au-wrap">
					<span><strong>{x.filename}</strong> <span class="au-muted">{formatWhen(x.createdAt)}</span></span>
					<a class="au-btn au-btn--small" href="{base}/documents/{x.id}/file" download>Download</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
