<script lang="ts">
	import SelectionBar from '#lib/components/SelectionBar.svelte';
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
	const needsReview = $derived(
		data.internal.filter((r) => r.recheck === 'needs_review' && !r.recheckProposal)
	);
	// AI's proposals after a new version: an update or a removal, for the auditor to accept or reject.
	const recheckProposals = $derived(
		data.internal.filter((r) => r.recheck === 'needs_review' && r.recheckProposal)
	);
	let selectedRecheck = $state<string[]>([]);
	const proposed = $derived(
		data.internal.filter((r) => r.status === 'proposed' && r.recheck !== 'needs_review')
	);
	const confirmed = $derived(
		data.internal.filter((r) => r.status === 'confirmed' && r.recheck !== 'needs_review')
	);
	let selectedReview = $state<string[]>([]);
	let editing = $state<string | null>(null);
	let newVersionOf = $state<string | null>(null);
	let showReplaced = $state(false);
	const replacedCount = $derived(data.documents.filter((d) => d.replacedBy).length);
	const shownDocuments = $derived(data.documents.filter((d) => showReplaced || !d.replacedBy));
	const docName = $derived(new Map(data.documents.map((d) => [d.id, d.displayName])));
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
				newVersionOf = null;
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
	let selectedInternal = $state<string[]>([]);
</script>

<svelte:head><title>Documents · Set-up · mcp-audit</title></svelte:head>

{#snippet newVersionForm(id: string, name: string)}
	<form
		method="POST"
		action="?/newVersion"
		enctype="multipart/form-data"
		class="au-form au-grow"
		use:enhance={() => {
			uploading = true;
			return after();
		}}
	>
		<input type="hidden" name="id" value={id} />
		<div class="au-field">
			<label for="newver-{id}">New version of {name}</label>
			<input id="newver-{id}" name="file" type="file" required />
			<span class="au-muted">The current file stays, with its evidence links, marked as replaced.</span>
		</div>
		{#if failed('newVersion', id)}<p class="au-field__error">
				{failed('newVersion', id)?.message}
			</p>{/if}
		<div class="au-row">
			<button class="au-btn au-btn--primary au-btn--small" type="submit" disabled={uploading}
				>{uploading ? 'Uploading…' : 'Upload new version'}</button
			>
			<button class="au-btn au-btn--ghost au-btn--small" type="button" onclick={() => (newVersionOf = null)}
				>Cancel</button
			>
		</div>
	</form>
{/snippet}

<FormMessage form={result} />

{#each data.toReview as v (v.artifactId)}
	<div class="au-alert au-alert--warn au-stack" role="status" data-testid="review-banner">
		<p>
			{v.count} internal {v.count === 1 ? 'requirement needs' : 'requirements need'} review after a new version
			of {v.previousName ?? v.name}{v.proposals
				? `; ${v.proposals} ${v.proposals === 1 ? 'proposal waits' : 'proposals wait'} for you`
				: ''}.
			<a href="#needs-review">Review them</a>
		</p>
		<AiAction
			action="recheck_internal"
			label="Recheck against new version"
			context={{ artifact_id: v.artifactId }}
			hint={v.count > v.proposals
				? 'Compares each with the new version and proposes an update or a removal, for you to accept or reject.'
				: 'Every one has a proposal below; running it again replaces them.'}
		/>
	</div>
{/each}

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
	{#if replacedCount}
		<label class="au-check-row">
			<input type="checkbox" bind:checked={showReplaced} />
			Show replaced versions ({replacedCount})
		</label>
	{/if}
	<ul class="au-list" aria-label="Documents">
		{#each shownDocuments as d (d.id)}
			<li>
				<ItemCard
					ref={[
						d.kind ? kindLabel.get(d.kind) : 'Kind not set',
						d.filename,
						size(d.size),
						d.versionLabel ? `v ${d.versionLabel}` : null,
						d.approvalDate ? `approved ${d.approvalDate}` : null,
						d.supersedesId ? `replaces ${docName.get(d.supersedesId) ?? 'an earlier version'}` : null
					]
						.filter(Boolean)
						.join(' · ')}
					title={d.displayName}
					href="?item=artifact:{d.id}"
					badge={d.replacedBy
						? { label: `Replaced by ${d.replacedBy.displayName}`, tone: 'neutral' }
						: d.state === 'mentioned'
							? { label: 'Mentioned, not received', tone: 'warn' }
							: d.textStatus === 'extracted'
								? { label: TEXT.extracted, tone: 'ok' }
								: d.textStatus === 'failed'
									? { label: TEXT.failed, tone: 'danger' }
									: null}
					version={d.version}
					testid="document-{d.filename ?? d.displayName}"
				>
					{#snippet details()}
						{@const open = data.openSections[d.id]}
						{#if open?.length && !d.replacedBy}
							<div class="au-stack" data-testid="open-sections">
								<p class="au-muted">
									Sections of this version with no internal requirement:
									{open
										.slice(0, 12)
										.map((h) => `${h.number} ${h.title}`)
										.join(' · ')}{open.length > 12 ? ` and ${open.length - 12} more` : ''}.
								</p>
								<AiAction
									action="extract_internal"
									label="Extract from these sections"
									context={{
										artifact_id: d.id,
										sections: open.map((h) => h.number).join(', ')
									}}
								/>
							</div>
						{/if}
					{/snippet}
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
						{:else if newVersionOf === d.id || failed('newVersion', d.id)}
							{@render newVersionForm(d.id, d.displayName)}
						{:else}
							<button
								class="au-btn au-btn--small"
								type="button"
								onclick={() => (editing = d.id)}
								aria-label="Edit {d.displayName}">Edit</button
							>
							{#if d.state === 'received' && d.fileHash && !d.replacedBy}<button
									class="au-btn au-btn--small"
									type="button"
									onclick={() => (newVersionOf = d.id)}
									aria-label="Upload new version of {d.displayName}">Upload new version</button
								>{/if}
							{#if d.replacedBy}<a
									class="au-btn au-btn--small au-btn--ghost"
									href="?item=artifact:{d.replacedBy.id}"
									data-sveltekit-reset="false">Open new version</a
								>{/if}
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

	{#if data.carried.length}
		<h3 class="au-section__title">From earlier engagements</h3>
		<p class="au-muted">
			Documents whose internal requirements are carried over. When the auditee sends a new version, upload it
			here: the requirements are copied to this engagement and checked against it, and the earlier engagement
			keeps its records.
		</p>
		<ul class="au-list" aria-label="Documents from earlier engagements">
			{#each data.carried as d (d.id)}
				<li>
					<ItemCard
						ref="{d.engagementName} · {d.requirements} internal {d.requirements === 1
							? 'requirement'
							: 'requirements'} carried over"
						title={d.name}
						testid="carried-{d.name}"
					>
						{#snippet actions()}
							{#if newVersionOf === d.id || failed('newVersion', d.id)}
								{@render newVersionForm(d.id, d.name)}
							{:else}
								<button
									class="au-btn au-btn--small"
									type="button"
									onclick={() => (newVersionOf = d.id)}
									aria-label="Upload new version of {d.name}">Upload new version</button
								>
							{/if}
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{/if}
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
					>{#each data.documents.filter((d) => d.state === 'received' && !d.replacedBy) as d (d.id)}<option
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

	<span id="needs-review"></span>
	{#if recheckProposals.length}
		<h3 class="au-section__title">Proposed after a new version ({recheckProposals.length})</h3>
		<p class="au-muted">
			AI compared these with the new version of their document. Accept to take the update or remove the
			requirement; reject to decide yourself below.
		</p>
		<SelectionBar
			id="select-recheck"
			all={recheckProposals.map((r) => r.id)}
			bind:selected={selectedRecheck}
			acceptAction="?/acceptRecheckSelected"
			rejectAction="?/rejectRecheckSelected"
			noun={['proposal', 'proposals']}
		/>
		<ul class="au-list" aria-label="Proposals after a new version">
			{#each recheckProposals as r (r.id)}
				{@const was = r.previous}
				<li>
					<ItemCard
						state="proposed"
						badge={r.recheckProposal === 'remove'
							? { label: 'Remove', tone: 'danger' }
							: { label: 'Update', tone: 'ai' }}
						ref="{r.refCode} · {r.sourceTitle}{r.section ? ` § ${r.section}` : ''}"
						title={r.title}
						href="?item=requirement:{r.id}"
						version={r.version}
						testid="recheck-{r.refCode}"
					>
						{#snippet details()}
							<p class="au-muted" data-testid="recheck-proposal">
								{#if r.recheckProposal === 'remove'}
									Proposed: remove it.{#if r.quote}
										Old quote: <span class="au-diff-del">“{r.quote}”</span>{/if}
								{:else if was}
									Proposed update.
									{#if was.title !== r.title}<br /><span class="au-diff-del">{was.title}</span> →
										<span class="au-diff-ins">{r.title}</span>{/if}
									{#if was.quote !== r.quote}<br /><span class="au-diff-del"
											>{was.quote ? `“${was.quote}”` : '(no quote)'}</span
										>
										→ <span class="au-diff-ins">{r.quote ? `“${r.quote}”` : '(no quote)'}</span>{/if}
									{#if was.section !== r.section}<br />§
										<span class="au-diff-del">{was.section ?? '(none)'}</span>
										→ <span class="au-diff-ins">{r.section ?? '(none)'}</span>{/if}
									{#if was.text !== r.text}<br /><span class="au-diff-del">{was.text ?? '(no text)'}</span>
										→ <span class="au-diff-ins">{r.text ?? '(no text)'}</span>{/if}
								{:else}
									Proposed update{r.quote ? `: “${r.quote}”` : ''}.
								{/if}
								{#if r.recheckReason}<br />Why: {r.recheckReason}{/if}
							</p>
						{/snippet}
						{#snippet actions()}
							{#if recheckProposals.length > 1}
								<label class="au-check-row au-select">
									<input
										type="checkbox"
										form="select-recheck"
										name="ids"
										value={r.id}
										bind:group={selectedRecheck}
										aria-label="Select the proposal for {r.refCode}"
									/>
									Select
								</label>
							{/if}
							<form method="POST" action="?/acceptRecheck" use:enhance={after}>
								<input type="hidden" name="id" value={r.id} /><button
									class="au-btn au-btn--small au-btn--primary"
									type="submit"
									aria-label="Accept the proposal for {r.refCode}">Accept</button
								>
							</form>
							<form method="POST" action="?/rejectRecheck" use:enhance={after}>
								<input type="hidden" name="id" value={r.id} /><button
									class="au-btn au-btn--small au-btn--ghost"
									type="submit"
									aria-label="Reject the proposal for {r.refCode}">Reject</button
								>
							</form>
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{/if}

	{#if needsReview.length}
		<h3 class="au-section__title">Needs review after a new version ({needsReview.length})</h3>
		<p class="au-muted">
			The quote of these requirements is not in the new version of their document. Keep each as it is, take
			the closest passage of the new text as its quote, or remove it.
		</p>
		<SelectionBar
			id="select-review"
			all={needsReview.map((r) => r.id)}
			bind:selected={selectedReview}
			acceptAction="?/keepSelected"
			rejectAction="?/removeSelected"
			noun={['internal requirement', 'internal requirements']}
			verbs={['Keep', 'Remove']}
		/>
		<ul class="au-list" aria-label="Internal requirements to review">
			{#each needsReview as r (r.id)}
				<li>
					<ItemCard
						state={r.status === 'proposed' ? 'proposed' : 'default'}
						badge={{ label: 'Needs review', tone: 'warn' }}
						ref="{r.refCode} · {r.sourceTitle}{r.section ? ` § ${r.section}` : ''}"
						title={r.title}
						href="?item=requirement:{r.id}"
						version={r.version}
						testid="review-{r.refCode}"
					>
						{#snippet details()}
							<p class="au-muted" data-testid="review-compare">
								{#if r.quote}Old quote: <span class="au-diff-del">“{r.quote}”</span>{:else}No quote was
									recorded.{/if}
								<br />
								{#if r.recheckPassage}Closest in the new version:
									<span class="au-diff-ins">“{r.recheckPassage}”</span>{:else}Nothing close was found in the
									new version.{/if}
							</p>
						{/snippet}
						{#snippet actions()}
							{#if needsReview.length > 1}
								<label class="au-check-row au-select">
									<input
										type="checkbox"
										form="select-review"
										name="ids"
										value={r.id}
										bind:group={selectedReview}
										aria-label="Select {r.refCode} to review"
									/>
									Select
								</label>
							{/if}
							<form method="POST" action="?/keep" use:enhance={after}>
								<input type="hidden" name="id" value={r.id} /><button
									class="au-btn au-btn--small au-btn--primary"
									type="submit"
									aria-label="Keep {r.refCode}">Keep</button
								>
							</form>
							{#if r.recheckPassage}
								<form method="POST" action="?/keep" use:enhance={after}>
									<input type="hidden" name="id" value={r.id} /><input
										type="hidden"
										name="use_new_passage"
										value="true"
									/><button
										class="au-btn au-btn--small"
										type="submit"
										aria-label="Use the new passage for {r.refCode}">Use new passage</button
									>
								</form>
							{/if}
							<form method="POST" action="?/removeReview" use:enhance={after}>
								<input type="hidden" name="id" value={r.id} /><button
									class="au-btn au-btn--small au-btn--ghost"
									type="submit"
									aria-label="Remove {r.refCode}">Remove</button
								>
							</form>
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{/if}

	{#if proposed.length}
		<ProposalBar types={['internal']}>
			<form method="POST" action="?/acceptAll" use:enhance={after}>
				<button class="au-btn au-btn--primary au-btn--small" type="submit">Accept all</button>
			</form>
		</ProposalBar>
		<h3 class="au-section__title">Proposed ({proposed.length})</h3>
		<SelectionBar
			id="select-internal"
			all={proposed.map((r) => r.id)}
			bind:selected={selectedInternal}
			acceptAction="?/acceptSelected"
			rejectAction="?/rejectSelected"
			noun={['internal requirement', 'internal requirements']}
		/>
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
						{#snippet details()}
							{#if r.previous && (r.previous.title !== r.title || r.previous.quote !== r.quote || r.previous.section !== r.section || r.previous.text !== r.text)}
								{@const was = r.previous}
								<p class="au-muted" data-testid="internal-was">
									Changes an accepted requirement. Was:
									{#if was.title !== r.title}<span class="au-diff-del">{was.title}</span>{/if}
									{#if was.quote !== r.quote}<br /><span class="au-diff-del"
											>{was.quote ? `“${was.quote}”` : '(no quote)'}</span
										>
										→ <span class="au-diff-ins">{r.quote ? `“${r.quote}”` : '(no quote)'}</span>{/if}
									{#if was.section !== r.section}<br />§
										<span class="au-diff-del">{was.section ?? '(none)'}</span>
										→ <span class="au-diff-ins">{r.section ?? '(none)'}</span>{/if}
									{#if was.text !== r.text}<br /><span class="au-diff-del">{was.text ?? '(no text)'}</span>
										→ <span class="au-diff-ins">{r.text ?? '(no text)'}</span>{/if}
								</p>
							{:else if r.previous && r.recheck === 'unchanged'}
								<p class="au-muted">An accepted requirement, checked against the new version: quote found.</p>
							{/if}
						{/snippet}
						{#snippet actions()}
							{#if proposed.length > 1}
								<label class="au-check-row au-select">
									<input
										type="checkbox"
										form="select-internal"
										name="ids"
										value={r.id}
										bind:group={selectedInternal}
										aria-label="Select {r.refCode}"
									/>
									Select
								</label>
							{/if}
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
							: ''}{r.recheck === 'unchanged' ? ' · quote found in this version' : ''}"
						title={r.title}
						href="?item=requirement:{r.id}"
						body={[
							r.quote ? `“${r.quote}”` : null,
							r.implements.length
								? `Implements ${r.implements.map((l) => `${l.other.refCode} (${l.coverage})`).join(', ')}`
								: 'Implements nothing yet'
						]
							.filter(Boolean)
							.join(' · ')}
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
