<script lang="ts">
	import AiAction from '#lib/components/ai/AiAction.svelte';
	import ProposalBar from '#lib/components/ai/ProposalBar.svelte';
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';

	let { data, form } = $props();
	type Result = {
		message?: string;
		success?: string;
		fields?: Record<string, string>;
		values?: Record<string, string>;
	};
	const result = $derived((form ?? null) as Result | null);
	const e = $derived(data.engagement);
	const kindLabel = $derived(new Map(data.kinds));
	const proposed = $derived(data.internal.filter((r) => r.status === 'proposed'));
	const confirmed = $derived(data.internal.filter((r) => r.status === 'confirmed'));
	let editing = $state<string | null>(null);
	let mentioning = $state(false);
	let addingInternal = $state(false);
	let uploading = $state(false);
	const failed = (action: string, id?: string) =>
		result?.message && result.values?.action === action && (!id || result.values.id === id) ? result : null;
	const after =
		() =>
		async ({
			update,
			result: r
		}: {
			update: (o?: { reset?: boolean }) => Promise<void>;
			result: { type: string };
		}) => {
			await update({ reset: r.type === 'success' });
			uploading = false;
			if (r.type === 'success') {
				editing = null;
				mentioning = false;
				addingInternal = false;
			}
		};
	const TEXT = {
		extracted: 'Text read',
		failed: 'Text could not be read',
		unsupported: 'No text (not a text format)',
		none: ''
	};
	const size = (n: number | null) =>
		n == null
			? ''
			: n < 1024
				? `${n} B`
				: n < 1048576
					? `${Math.round(n / 1024)} KB`
					: `${(n / 1048576).toFixed(1)} MB`;
</script>

<svelte:head><title>Documents · Set-up · mcp-audit</title></svelte:head>

<FormMessage form={result} />

<section class="au-section" aria-labelledby="docs-title">
	<h2 class="au-section__title" id="docs-title">Documents</h2>
	<form
		method="POST"
		action="?/upload"
		enctype="multipart/form-data"
		class="au-form au-item"
		use:enhance={() => {
			uploading = true;
			return after();
		}}
	>
		<div class="au-field">
			<label for="files">Upload documents</label>
			<input id="files" name="files" type="file" multiple required />
			<span class="au-muted"
				>One or many files. Title and kind can be added afterwards. PDF, Word (.docx) and text files are read
				for search.</span
			>
		</div>
		<div class="au-row">
			<button class="au-btn au-btn--primary" type="submit" disabled={uploading}
				>{uploading ? 'Uploading…' : 'Upload'}</button
			>
			{#if !mentioning}<button class="au-btn au-btn--ghost" type="button" onclick={() => (mentioning = true)}
					>Record a mentioned document</button
				>{/if}
		</div>
	</form>

	{#if mentioning || failed('mention')}
		<form method="POST" action="?/mention" class="au-form au-item" use:enhance={after}>
			<p class="au-muted">A document named in an interview that you have not received yet.</p>
			<Field
				label="Document name"
				name="title"
				id="mention-title"
				required
				value={failed('mention')?.values?.title ?? ''}
				error={failed('mention')?.fields?.title}
			/>
			<div class="au-field">
				<label for="mention-kind">Kind (optional)</label>
				<select id="mention-kind" name="kind"
					><option value="">Not set</option>{#each data.kinds as [k, l] (k)}<option value={k}>{l}</option
						>{/each}</select
				>
			</div>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit">Record document</button>
				<button class="au-btn au-btn--ghost" type="button" onclick={() => (mentioning = false)}>Cancel</button
				>
			</div>
		</form>
	{/if}

	{#if data.documents.length === 0}
		<div class="au-empty">
			<p>No documents yet. Upload the auditee’s policies, procedures and registers.</p>
		</div>
	{/if}
	<ul class="au-list" aria-label="Documents">
		{#each data.documents as d (d.id)}
			<li>
				<ItemCard
					ref={[
						d.kind ? kindLabel.get(d.kind) : 'Kind not set',
						d.filename,
						size(d.size),
						d.versionLabel ? `v ${d.versionLabel}` : null,
						d.approvalDate ? `approved ${d.approvalDate}` : null
					]
						.filter(Boolean)
						.join(' · ')}
					title={d.displayName}
					href="?item=artifact:{d.id}"
					badge={d.state === 'mentioned'
						? { label: 'Mentioned, not received', tone: 'warn' }
						: d.textStatus === 'extracted'
							? { label: TEXT.extracted, tone: 'ok' }
							: d.textStatus === 'failed'
								? { label: TEXT.failed, tone: 'danger' }
								: null}
					version={d.version}
					testid="document-{d.filename ?? d.displayName}"
				>
					{#snippet actions()}
						{#if editing === d.id || failed('meta', d.id)}
							{@const v = failed('meta', d.id)?.values ?? {
								title: d.title ?? '',
								kind: d.kind ?? '',
								version_label: d.versionLabel ?? '',
								approval_date: d.approvalDate ?? '',
								language: d.language ?? ''
							}}
							{@const f = failed('meta', d.id)?.fields ?? {}}
							<form method="POST" action="?/meta" class="au-form au-grow" use:enhance={after}>
								<input type="hidden" name="id" value={d.id} />
								<input type="hidden" name="base_version" value={d.version} />
								<Field label="Title" name="title" id="title-{d.id}" value={v.title} error={f.title} />
								<div class="au-field">
									<label for="kind-{d.id}">Kind</label>
									<select id="kind-{d.id}" name="kind"
										><option value="">Not set</option>{#each data.kinds as [k, l] (k)}<option
												value={k}
												selected={v.kind === k}>{l}</option
											>{/each}</select
									>
								</div>
								<Field label="Version" name="version_label" id="ver-{d.id}" value={v.version_label} />
								<Field
									label="Approved on"
									name="approval_date"
									id="appr-{d.id}"
									type="date"
									value={v.approval_date}
									error={f.approval_date}
								/>
								<Field
									label="Language"
									name="language"
									id="lang-{d.id}"
									value={v.language}
									placeholder="en"
								/>
								<div class="au-row">
									<button class="au-btn au-btn--primary au-btn--small" type="submit">Save document</button>
									<button
										class="au-btn au-btn--ghost au-btn--small"
										type="button"
										onclick={() => (editing = null)}>Cancel</button
									>
								</div>
							</form>
						{:else}
							<button
								class="au-btn au-btn--small"
								type="button"
								onclick={() => (editing = d.id)}
								aria-label="Edit {d.displayName}">Edit</button
							>
							{#if d.fileHash}<a
									class="au-btn au-btn--small au-btn--ghost"
									href="/e/{e.id}/documents/{d.id}/file"
									download>Download</a
								>{/if}
							<form method="POST" action="?/remove" use:enhance={after}>
								<input type="hidden" name="id" value={d.id} />
								<button
									class="au-btn au-btn--small au-btn--ghost"
									type="submit"
									aria-label="Remove {d.displayName}">Remove</button
								>
							</form>
						{/if}
					{/snippet}
				</ItemCard>
			</li>
		{/each}
	</ul>
</section>

<section class="au-section" aria-labelledby="internal-title">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="internal-title">Internal requirements</h2>
		{#if !addingInternal && !failed('addInternal')}
			<button class="au-btn" type="button" onclick={() => (addingInternal = true)}
				>Add internal requirement</button
			>
		{/if}
	</div>
	<p class="au-muted">
		Rules the auditee set for itself in these documents, each implementing an external requirement. AI can
		propose them from the documents, here or from Claude through the set-up skill; you accept or reject each.
	</p>
	<AiAction
		action="extract_internal"
		label="Extract requirements"
		hint="Reads the documents not analysed yet and proposes internal requirements mapped to the selected ones."
	/>

	{#if data.carryOver && !e.carryOverInternal}
		<div class="au-alert au-alert--info" role="status" data-testid="carry-over">
			<p>
				{data.carryOver} confirmed internal {data.carryOver === 1 ? 'requirement' : 'requirements'} from earlier
				engagements with {e.auditeeName}.
			</p>
			<form method="POST" action="?/carryOver" use:enhance={after}>
				<input type="hidden" name="base_version" value={e.version} /><input
					type="hidden"
					name="on"
					value="true"
				/>
				<button class="au-btn au-btn--small" type="submit">Carry them over</button>
			</form>
		</div>
	{:else if e.carryOverInternal}
		<form method="POST" action="?/carryOver" class="au-row" use:enhance={after}>
			<span class="au-muted">Internal requirements from earlier engagements are carried over.</span>
			<input type="hidden" name="base_version" value={e.version} /><input
				type="hidden"
				name="on"
				value="false"
			/>
			<button class="au-btn au-btn--small au-btn--ghost" type="submit">Stop carrying over</button>
		</form>
	{/if}

	{#if addingInternal || failed('addInternal')}
		{@const v = failed('addInternal')?.values ?? {}}
		{@const f = failed('addInternal')?.fields ?? {}}
		<form method="POST" action="?/addInternal" class="au-form au-item" use:enhance={after}>
			<Field
				label="Requirement"
				name="title"
				id="int-title"
				required
				value={v.title ?? ''}
				error={f.title}
				placeholder="Leaver accounts disabled within one day"
			/>
			<div class="au-field">
				<label for="int-text">Text (optional)</label><textarea
					id="int-text"
					name="text"
					rows="2"
					defaultValue={v.text ?? ''}></textarea>
			</div>
			<div class="au-field">
				<label for="int-quote">Quote in the original language (optional)</label><textarea
					id="int-quote"
					name="quote"
					rows="2"
					defaultValue={v.quote ?? ''}></textarea>
			</div>
			<div class="au-field">
				<label for="int-doc">Document</label>
				<select id="int-doc" name="artifact"
					><option value="">None (added by hand)</option
					>{#each data.documents.filter((d) => d.state === 'received') as d (d.id)}<option
							value={d.id}
							selected={v.artifact === d.id}>{d.displayName}</option
						>{/each}</select
				>
			</div>
			<Field
				label="Section (optional)"
				name="section"
				id="int-section"
				value={v.section ?? ''}
				placeholder="4.2"
			/>
			<div class="au-row">
				<div class="au-field">
					<label for="int-impl">Implements</label>
					<select id="int-impl" name="implements"
						><option value="">Not linked yet</option>{#each data.requirements as r (r.id)}<option
								value={r.id}
								selected={v.implements === r.id}>{r.refCode} {r.title}</option
							>{/each}</select
					>
				</div>
				<div class="au-field">
					<label for="int-cov">Coverage</label>
					<select id="int-cov" name="coverage"
						><option value="partial">Partial</option><option value="full" selected={v.coverage === 'full'}
							>Full</option
						></select
					>
				</div>
			</div>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit">Add internal requirement</button>
				<button class="au-btn au-btn--ghost" type="button" onclick={() => (addingInternal = false)}
					>Cancel</button
				>
			</div>
		</form>
	{/if}

	{#if proposed.length}
		<ProposalBar types={['internal']}>
			<form method="POST" action="?/acceptAll" use:enhance={after}>
				<button class="au-btn au-btn--primary au-btn--small" type="submit">Accept all</button>
			</form>
		</ProposalBar>
		<h3 class="au-section__title">Proposed ({proposed.length})</h3>
		<ul class="au-list" aria-label="Proposed internal requirements">
			{#each proposed as r (r.id)}
				<li>
					<ItemCard
						state="proposed"
						ref="{r.refCode} · {r.sourceTitle}{r.section ? ` § ${r.section}` : ''}"
						title={r.title}
						href="?item=requirement:{r.id}"
						body={[
							r.quote ? `“${r.quote}”` : null,
							r.implements.length
								? `Implements ${r.implements.map((l) => `${l.other.refCode} (${l.coverage})`).join(', ')}`
								: null
						]
							.filter(Boolean)
							.join(' · ') || null}
						testid="internal-{r.refCode}"
					>
						{#snippet actions()}
							<form method="POST" action="?/accept" use:enhance={after}>
								<input type="hidden" name="id" value={r.id} /><button
									class="au-btn au-btn--small au-btn--primary"
									type="submit"
									aria-label="Accept {r.refCode}">Accept</button
								>
							</form>
							<form method="POST" action="?/reject" use:enhance={after}>
								<input type="hidden" name="id" value={r.id} /><button
									class="au-btn au-btn--small au-btn--ghost"
									type="submit"
									aria-label="Reject {r.refCode}">Reject</button
								>
							</form>
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{/if}

	{#if confirmed.length}
		<ul class="au-list" aria-label="Internal requirements">
			{#each confirmed as r (r.id)}
				<li>
					<ItemCard
						ref="{r.refCode} · {r.sourceTitle}{r.section ? ` § ${r.section}` : ''}{r.carriedOver
							? ' · carried over'
							: ''}"
						title={r.title}
						href="?item=requirement:{r.id}"
						body={r.implements.length
							? `Implements ${r.implements.map((l) => `${l.other.refCode} (${l.coverage})`).join(', ')}`
							: 'Implements nothing yet'}
						version={r.version}
						testid="internal-{r.refCode}"
					>
						{#snippet actions()}
							{#if !r.carriedOver}
								<form method="POST" action="?/reject" use:enhance={after}>
									<input type="hidden" name="id" value={r.id} /><button
										class="au-btn au-btn--small au-btn--ghost"
										type="submit"
										aria-label="Remove {r.refCode}">Remove</button
									>
								</form>
							{/if}
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{:else if !proposed.length}
		<p class="au-muted">No internal requirements yet.</p>
	{/if}
</section>
