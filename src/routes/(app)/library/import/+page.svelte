<script lang="ts">
	import { page } from '$app/state';
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
		values?: Record<string, string>;
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
	/** A refused role edit (#112) keeps the panel open with what was typed. */
	const editError = $derived(result?.message && result.values?.action === 'addRole' ? result : null);
	/** The role editor stays open while the auditor works in it, and opens on a refused edit. */
	let editOpen = $state(false);
	$effect(() => {
		if (editError) editOpen = true;
	});

	let documentId = $state('');
	let code = $state('');
	let title = $state('');
	let target = $state('');
	/** What the auditor asks Find roles to look for (#112). */
	let hint = $state('');
	const pick = (id: string) => {
		documentId = id;
		document.getElementById('extract-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	};
	const doc = $derived(data.documents.find((d) => d.id === documentId) ?? null);
	/** The source made from the chosen document (the one with the typed code, else the first), and its roles (#108). */
	const docSource = $derived(
		doc ? (doc.sources.find((s) => s.code === code.trim().toLowerCase()) ?? doc.sources[0] ?? null) : null
	);
	const roles = $derived(docSource?.roles ?? []);
	let chosen = $state<string[]>([]);
	// A new set of roles starts with all of them ticked.
	let rolesKey = '';
	$effect.pre(() => {
		const k = `${docSource?.id ?? ''}:${roles.map((r) => r.key).join(',')}`;
		if (k !== rolesKey) {
			rolesKey = k;
			chosen = roles.map((r) => r.key);
		}
	});
	const allChosen = $derived(roles.length > 0 && chosen.length === roles.length);
	const sourceCode = $derived(code.trim().toLowerCase() || docSource?.code || undefined);
	const targetSource = $derived(data.sources.find((s) => s.code === target) ?? null);
	$effect.pre(() => {
		if (!documentId && data.documents.length) documentId = result?.uploaded ?? data.documents[0]!.id;
	});
	const codeOrPlaceholder = $derived(code.trim().toLowerCase() || '<code>');
	const importPrompt = $derived(
		`Use the mcp-audit tools and the audit-library-curator skill to import requirements into the library. Read the library document "${doc?.title ?? '<document>'}"${doc ? ` (id ${doc.id})` : ''} with get_library_document_text, page by page.
1. Find whom it sets auditable obligations for (its roles, such as essential and important entities). Create the source with upsert_sources (code "${codeOrPlaceholder}", ${title.trim() ? `title "${title.trim()}"` : 'the title'}, type law or standard, the language, a licence note, document_id${doc ? ` "${doc.id}"` : ''} and the roles), then show me the roles and ask which to import.
2. For the roles I choose, add the auditable requirements only with upsert_requirements: the reference as written, a short title, a self-contained text (spell out what references to other provisions say, as far as the audit needs), the original passage as source_text where the text is reworded, the roles each applies to, and the parent heading so the structure is kept. Skip recitals, definitions, duties of authorities and final provisions, and tell me what you skipped.
For a licensed standard store codes and titles only unless I confirm the licence allows the text. Everything you write is proposed; tell me how many requirements wait on Library, Review.`
	);
	const mapPrompt = $derived(
		`Use the mcp-audit tools to map source "${codeOrPlaceholder}" to "${targetSource?.title ?? '<target>'}" (source ${targetSource?.code ?? '<target code>'}). Read both with search_requirements and get_requirement. For each requirement of ${codeOrPlaceholder}, propose links to ${targetSource?.code ?? '<target code>'} with link_requirements: implements (with coverage full or partial), details, explains or equivalent, and a one-line reason in note; start the reason with "Low confidence:" where it applies. Do not force a link where the texts only share a topic. Tell me how many links wait on Library, Mapping.`
	);
	const waiting = $derived(data.waiting.imports + data.waiting.changes + data.waiting.links);
</script>

<svelte:head><title>Import · Library · {page.data.instance}</title></svelte:head>

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
			<ol class="au-import-steps">
				<li>
					<p>
						<strong>Find roles.</strong>
						<span class="au-muted"
							>Reads whom the document applies to, such as essential and important entities, and creates the
							proposed source.</span
						>
					</p>
					<div class="au-field">
						<label for="roles-hint">What to look for (optional)</label>
						<input
							id="roles-hint"
							bind:value={hint}
							maxlength="500"
							placeholder="For example: management, personnel, suppliers"
							autocomplete="off"
						/>
					</div>
					<AiAction
						action="library_roles"
						label={roles.length ? 'Find roles again' : 'Find roles'}
						hint={roles.length ? 'Keeps the roles below and adds the ones it finds missing.' : undefined}
						context={{
							document_id: documentId,
							source_code: sourceCode,
							source_title: title.trim() || undefined,
							hint: hint.trim() || undefined
						}}
						validate={() =>
							documentId ? null : 'Upload the document in step 1 and choose it above, then find its roles.'}
					/>
				</li>
				<li>
					{#if roles.length}
						<fieldset class="au-roles" data-testid="import-roles">
							<legend><strong>Choose the roles to import.</strong></legend>
							<label class="au-check-row au-roles__role">
								<input
									type="checkbox"
									checked={allChosen}
									indeterminate={chosen.length > 0 && !allChosen}
									onchange={(e) => (chosen = e.currentTarget.checked ? roles.map((r) => r.key) : [])}
								/>
								<span>All roles</span>
							</label>
							{#each roles as r (r.key)}
								<label class="au-check-row au-roles__role">
									<input type="checkbox" value={r.key} bind:group={chosen} />
									<span
										>{r.label}{#if r.description}<span class="au-muted au-roles__desc">{r.description}</span
											>{/if}</span
									>
								</label>
							{/each}
						</fieldset>
					{:else}
						<p>
							<strong>Choose the roles to import.</strong>
							<span class="au-muted" data-testid="import-no-roles"
								>{doc
									? 'No roles found for this document yet. Find them first; extracting without roles imports what applies to everyone it addresses.'
									: 'Choose a document first.'}</span
							>
						</p>
					{/if}
					{#if doc}
						<details class="au-roles-edit" data-testid="edit-roles" bind:open={editOpen}>
							<summary>{roles.length ? 'Correct the roles' : 'Or add the roles yourself'}</summary>
							{#if docSource && roles.length}
								<ul class="au-list" aria-label="Roles of {docSource.title}">
									{#each roles as r (r.key)}
										<li class="au-roles-edit__role" data-testid="role-{r.key}">
											<form method="POST" action="?/updateRole" class="au-row au-wrap" use:enhance>
												<input type="hidden" name="source" value={docSource.id} />
												<input type="hidden" name="base_version" value={docSource.version} />
												<input type="hidden" name="key" value={r.key} />
												<div class="au-field">
													<label for="role-label-{r.key}">Role</label>
													<input id="role-label-{r.key}" name="label" defaultValue={r.label} required />
												</div>
												<div class="au-field au-grow">
													<label for="role-desc-{r.key}">Description</label>
													<input
														id="role-desc-{r.key}"
														name="description"
														defaultValue={r.description ?? ''}
													/>
												</div>
												<button class="au-btn au-btn--small" type="submit" aria-label="Save role {r.label}"
													>Save</button
												>
											</form>
											<form method="POST" action="?/removeRole" use:enhance>
												<input type="hidden" name="source" value={docSource.id} />
												<input type="hidden" name="base_version" value={docSource.version} />
												<input type="hidden" name="key" value={r.key} />
												<button
													class="au-btn au-btn--small au-btn--ghost"
													type="submit"
													aria-label="Remove role {r.label}">Remove</button
												>
											</form>
										</li>
									{/each}
								</ul>
							{/if}
							<form method="POST" action="?/addRole" class="au-row au-wrap au-roles-edit__add" use:enhance>
								{#if docSource}
									<input type="hidden" name="source" value={docSource.id} />
									<input type="hidden" name="base_version" value={docSource.version} />
								{:else}
									<input type="hidden" name="document_id" value={doc.id} />
									<input type="hidden" name="document_title" value={doc.title} />
									<input type="hidden" name="code" value={code.trim().toLowerCase()} />
									<input type="hidden" name="title" value={title.trim()} />
								{/if}
								<div class="au-field">
									<label for="new-role-label">New role</label>
									<input
										id="new-role-label"
										name="label"
										placeholder="For example: Top management"
										defaultValue={editError?.values?.label ?? ''}
										required
									/>
								</div>
								<div class="au-field au-grow">
									<label for="new-role-desc">Description (optional)</label>
									<input
										id="new-role-desc"
										name="description"
										placeholder="Who this is, and where the document defines it"
										defaultValue={editError?.values?.description ?? ''}
									/>
								</div>
								<button class="au-btn au-btn--small au-btn--primary" type="submit">Add role</button>
							</form>
							{#if !docSource}
								<p class="au-muted">
									This creates the proposed source with the code and title above, as Find roles would.
								</p>
							{/if}
						</details>
					{/if}
				</li>
				<li>
					<p>
						<strong>Extract requirements.</strong>
						<span class="au-muted"
							>Only auditable requirements{roles.length ? ' for the roles ticked' : ''}, each worded to stand
							on its own, with the original passage kept beside it.</span
						>
					</p>
					<AiAction
						action="library_extract"
						label="Extract requirements"
						context={{
							document_id: documentId,
							source_code: sourceCode,
							source_title: title.trim() || undefined,
							roles: roles.length
								? roles
										.filter((r) => chosen.includes(r.key))
										.map((r) => r.key)
										.join(',')
								: undefined
						}}
						validate={() =>
							!documentId
								? 'Upload the document in step 1 and choose it above, then extract.'
								: roles.length && !chosen.length
									? 'Tick at least one role to import.'
									: null}
					/>
				</li>
			</ol>
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
