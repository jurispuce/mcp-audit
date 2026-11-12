<script lang="ts">
	import AiAction from '#lib/components/ai/AiAction.svelte';
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ClaudePrompt from '#lib/components/library/ClaudePrompt.svelte';
	import { formatWhen } from '#lib/format.ts';

	let { data, form } = $props();
	type Result = {
		message?: string;
		success?: string;
		uploaded?: string | null;
		report?: {
			source: { created: boolean; title: string; code: string };
			requirements: Record<string, number>;
			links: { created: number };
			guidance: { created: number; updated: number };
			criteria: { created: number };
			notInFile: string[];
			warnings: string[];
		};
	};
	const result = $derived((form ?? null) as Result | null);

	let documentId = $state('');
	let code = $state('');
	let title = $state('');
	let target = $state('');
	const pick = (id: string) => {
		documentId = id;
		document.getElementById('extract-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	};
	const doc = $derived(data.documents.find((d) => d.id === documentId) ?? null);
	const targetSource = $derived(data.sources.find((s) => s.code === target) ?? null);
	$effect.pre(() => {
		if (!documentId && data.documents.length) documentId = result?.uploaded ?? data.documents[0]!.id;
	});
	const codeOrPlaceholder = $derived(code.trim().toLowerCase() || '<code>');
	const importPrompt = $derived(
		`Use the mcp-audit tools to import requirements into the library. Read the library document "${doc?.title ?? '<document>'}"${doc ? ` (id ${doc.id})` : ''} with get_library_document_text, page by page. Create the source with upsert_sources (code "${codeOrPlaceholder}", ${title.trim() ? `title "${title.trim()}"` : 'the title'}, type law or standard, the language, a licence note, and document_id${doc ? ` "${doc.id}"` : ''}). Then add every requirement with upsert_requirements: the reference as written (article, paragraph, point, control), a short title, the text, and the parent reference so the structure is kept. For a licensed standard store codes and titles only unless I confirm the licence allows the text. Everything you write is proposed; tell me how many requirements wait on Library, Review.`
	);
	const mapPrompt = $derived(
		`Use the mcp-audit tools to map source "${codeOrPlaceholder}" to "${targetSource?.title ?? '<target>'}" (source ${targetSource?.code ?? '<target code>'}). Read both with search_requirements and get_requirement. For each requirement of ${codeOrPlaceholder}, propose links to ${targetSource?.code ?? '<target code>'} with link_requirements: implements (with coverage full or partial), details, explains or equivalent, and a one-line reason in note; start the reason with "Low confidence:" where it applies. Do not force a link where the texts only share a topic. Tell me how many links wait on Library, Mapping.`
	);
	const waiting = $derived(data.waiting.imports + data.waiting.changes + data.waiting.links);
</script>

<svelte:head><title>Import · Library · mcp-audit</title></svelte:head>

{#if result?.report}
	{@const r = result.report}
	<div class="au-alert au-alert--ok" role="status" data-testid="import-report">
		<p class="au-alert__title">{r.source.created ? 'Imported' : 'Updated'} {r.source.title}</p>
		<p>
			{r.requirements.created} new, {r.requirements.updated} changed, {r.requirements.restored} restored, {r
				.requirements.unchanged} unchanged requirements. {r.links.created} links,
			{r.guidance.created + r.guidance.updated} guidance and {r.criteria.created} criteria added or changed.
		</p>
		{#if r.notInFile.length}<p>Not in the file, left as they were: {r.notInFile.join(', ')}.</p>{/if}
		{#if r.warnings.length}<ul>
				{#each r.warnings as w, i (i)}<li>{w}</li>{/each}
			</ul>{/if}
		<div>
			<a class="au-btn" href="/library?source={encodeURIComponent(r.source.code)}">Open {r.source.title}</a>
		</div>
	</div>
{:else}
	<FormMessage form={result} />
{/if}

<p class="au-muted">
	Bring a law, regulation or standard into the library: upload the document, let AI extract its requirements,
	review and edit them, then map them to a source you already have. Nothing AI writes is used in audits until
	you accept it.
</p>

<section class="au-section" aria-labelledby="docs-title">
	<h2 class="au-section__title" id="docs-title">1. Upload the document</h2>
	<p class="au-muted">
		PDF, Word or text. Library documents are shared by every engagement: never upload client documents here;
		those belong on an engagement’s Set-up, Documents.
	</p>
	<form
		method="POST"
		action="?/upload"
		enctype="multipart/form-data"
		class="au-item au-stack"
		use:enhance={() =>
			async ({ update }) =>
				update()}
	>
		<div class="au-field">
			<label for="library-docs">Upload a law or standard</label>
			<input
				id="library-docs"
				name="documents"
				type="file"
				multiple
				accept=".pdf,.docx,.txt,.md,text/plain,application/pdf"
			/>
		</div>
		<div class="au-row"><button class="au-btn au-btn--primary" type="submit">Upload</button></div>
	</form>
	{#if data.documents.length}
		<ul class="au-list" aria-label="Library documents">
			{#each data.documents as d (d.id)}
				<li
					class="au-item"
					data-testid="libdoc-{d.filename}"
					data-selected={documentId === d.id ? '' : undefined}
				>
					<div class="au-row au-between au-wrap">
						<span
							><strong>{d.title}</strong>
							<span class="au-muted">{d.filename} · {formatWhen(d.createdAt)}</span></span
						>
						<span class="au-badge {d.textStatus === 'extracted' ? 'au-badge--ok' : 'au-badge--danger'}"
							>{d.textStatus === 'extracted'
								? 'Text read'
								: d.textStatus === 'failed'
									? 'Text could not be read'
									: 'Not a text format'}</span
						>
					</div>
					<div class="au-row au-wrap">
						<button
							class="au-btn au-btn--small {documentId === d.id ? 'au-btn--primary' : ''}"
							type="button"
							onclick={() => pick(d.id)}>Extract from this document</button
						>
						{#each d.sources as s (s.id)}<a
								class="au-btn au-btn--small"
								href={s.status === 'proposed'
									? '/library/review'
									: `/library?source=${encodeURIComponent(s.code)}`}
								>{s.title}{s.status === 'proposed' ? ' (proposed)' : ''}</a
							>{/each}
						<a class="au-btn au-btn--small au-btn--ghost" href="/library/documents/{d.id}/file" download
							>Download</a
						>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="au-section" aria-labelledby="extract-title">
	<h2 class="au-section__title" id="extract-title">2. Extract the requirements</h2>
	<div class="au-row au-wrap">
		<div class="au-field">
			<label for="claude-doc">Library document</label>
			<select id="claude-doc" bind:value={documentId}>
				<option value="">None, Claude has the file</option>
				{#each data.documents as d (d.id)}<option value={d.id}>{d.title}</option>{/each}
			</select>
		</div>
		<div class="au-field">
			<label for="claude-code">Source code for the import</label>
			<input id="claude-code" bind:value={code} placeholder="mk397" autocomplete="off" />
		</div>
		<div class="au-field au-grow">
			<label for="claude-title">Source title (optional)</label>
			<input id="claude-title" bind:value={title} placeholder="MK noteikumi Nr. 397" autocomplete="off" />
		</div>
	</div>
	<div class="au-import-ways">
		<div class="au-item au-stack">
			<h3 class="au-section__title">With the in-app AI</h3>
			<p class="au-muted">
				Reads the chosen document and writes a proposed source with its requirements, keeping the document's
				structure and reference codes.
			</p>
			<AiAction
				action="library_extract"
				label="Extract requirements"
				context={{
					document_id: documentId,
					source_code: code.trim().toLowerCase() || undefined,
					source_title: title.trim() || undefined
				}}
				validate={() =>
					documentId ? null : 'Upload the document in step 1 and choose it above, then extract.'}
			/>
		</div>
		<div class="au-item au-stack">
			<h3 class="au-section__title">With Claude Desktop or Claude Code</h3>
			<p class="au-muted">
				Connected to mcp-audit (Settings, Access tokens and <span class="au-ref">docs/mcp-connect.md</span>):
				paste this prompt. Claude reads the document through MCP.
			</p>
			<ClaudePrompt label="Import prompt" prompt={importPrompt} testid="import-prompt" />
		</div>
	</div>
	<p class="au-muted">
		For licensed standards such as ISO, keep to reference codes and titles unless your licence allows storing
		the text.
	</p>
</section>

<section class="au-section" aria-labelledby="review-title">
	<h2 class="au-section__title" id="review-title">3. Review and edit</h2>
	<p class="au-muted">
		Preview the extracted tree, correct titles and texts, accept or reject each requirement, then publish the
		source.
	</p>
	{#if waiting}
		<div class="au-proposal" data-testid="import-waiting">
			<span class="au-proposal__text"
				>Waiting for you: {data.waiting.imports} imported {data.waiting.imports === 1 ? 'source' : 'sources'}, {data
					.waiting.changes} requirement changes, {data.waiting.links} proposed links</span
			>
			<a class="au-btn au-btn--small au-btn--primary" href="/library/review">Review</a>
		</div>
	{:else}
		<div class="au-row"><a class="au-btn" href="/library/review">Open Review</a></div>
	{/if}
</section>

<section class="au-section" aria-labelledby="map-title">
	<h2 class="au-section__title" id="map-title">4. Map to an existing source</h2>
	<p class="au-muted">
		Choose the source to map to. On Library, Mapping, "Propose mapping" lets the in-app AI propose links with
		a reason each, or map by hand; with Claude, paste the mapping prompt. Accept, edit or reject each link
		there.
	</p>
	<div class="au-row au-wrap">
		<div class="au-field">
			<label for="claude-target">Map it to</label>
			<select id="claude-target" bind:value={target}>
				<option value="">Choose a source</option>
				{#each data.sources.filter((s) => s.status === 'active') as s (s.code)}<option value={s.code}
						>{s.title}</option
					>{/each}
			</select>
		</div>
		<a
			class="au-btn"
			style="align-self: flex-end"
			href="/library/mapping{code.trim() && target
				? `?from=${encodeURIComponent(code.trim().toLowerCase())}&to=${encodeURIComponent(target)}`
				: ''}">Open Mapping</a
		>
	</div>
	<ClaudePrompt label="Mapping prompt for Claude" prompt={mapPrompt} testid="map-prompt" />
</section>

<section class="au-section" aria-labelledby="yaml-title">
	<form method="POST" action="?/import" enctype="multipart/form-data" class="au-item au-stack" use:enhance>
		<h2 class="au-section__title" id="yaml-title">Import from YAML instead</h2>
		<p class="au-muted">
			A YAML file in the shape the audit skills use: <span class="au-ref"
				>id, title, type, language, licence_note, requirements</span
			>. Importing the same file again changes nothing; changed requirements become new versions. What you
			import this way is part of the library at once, without review.
		</p>
		<div class="au-field">
			<label for="import-file">YAML file</label>
			<input id="import-file" type="file" name="file" accept=".yaml,.yml,text/yaml" />
		</div>
		<div class="au-field">
			<label for="import-yaml">Or paste the YAML</label>
			<textarea id="import-yaml" name="yaml" rows="6"></textarea>
		</div>
		<div class="au-row"><button class="au-btn au-btn--primary" type="submit">Import source</button></div>
	</form>
</section>
