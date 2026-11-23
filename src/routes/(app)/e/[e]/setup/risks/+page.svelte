<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import AiAction from '#lib/components/ai/AiAction.svelte';
	import ProposalBar from '#lib/components/ai/ProposalBar.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import SelectionBar from '#lib/components/SelectionBar.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';
	import RiskForm from '#lib/components/RiskForm.svelte';

	let { data, form } = $props();
	type Result = {
		message?: string;
		success?: string;
		fields?: Record<string, string>;
		values?: Record<string, string>;
	};
	const result = $derived((form ?? null) as Result | null);
	const multiple = $derived(data.engagement.scopeMode === 'multiple');
	const refOf = $derived(new Map(data.requirements.map((r) => [r.id, r.refCode])));
	const scopeOf = $derived(new Map(data.scopes.map((s) => [s.id, s.name])));
	let adding = $state(false);
	let uploading = $state(false);
	let selectedRisks = $state<string[]>([]);
	const proposed = $derived(data.risks.filter((r) => r.proposed));
	const accepted = $derived(data.risks.filter((r) => !r.proposed));
	const TEXT: Record<string, string> = {
		extracted: 'Text read',
		failed: 'Text could not be read',
		unsupported: 'Not a readable format',
		none: ''
	};
	let editing = $state<string | null>(null);
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
				adding = false;
				editing = null;
			}
		};
	const LEVEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
	const ORIGIN: Record<string, string> = {
		auditee_register: 'Auditee register',
		auditor: 'Auditor view',
		research: 'Found by research'
	};
	const TONE: Record<string, 'danger' | 'warn' | 'neutral'> = {
		high: 'danger',
		medium: 'warn',
		low: 'neutral'
	};
	const asValues = (r: (typeof data.risks)[number]) => ({
		title: r.title,
		description: r.description ?? '',
		level: r.level,
		origin: r.origin,
		requirements: r.requirementIds.join(','),
		scopes: r.scopeIds.join(',')
	});
</script>

<svelte:head><title>Risks · Set-up · {page.data.instance}</title></svelte:head>

<FormMessage form={result} />

<section class="au-section" aria-labelledby="risks-title">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="risks-title">Risks</h2>
		{#if !adding && !failed('add') && data.risks.length}
			<button class="au-btn" type="button" onclick={() => (adding = true)}>Add risk</button>
		{/if}
	</div>

	<form
		method="POST"
		action="?/uploadRegister"
		enctype="multipart/form-data"
		class="au-form au-item"
		use:enhance={() => {
			uploading = true;
			return after();
		}}
	>
		<div class="au-field">
			<label for="register-file">Upload the auditee’s risk register</label>
			<input
				id="register-file"
				name="file"
				type="file"
				required
				accept=".pdf,.xlsx,.xlsm,.csv,.tsv,.docx,.md,.markdown,.txt"
			/>
			<span class="au-muted"
				>PDF, Excel (.xlsx), Word (.docx), CSV or Markdown. It is kept with the engagement’s documents; AI can
				then propose its risks for you to accept.</span
			>
		</div>
		<div class="au-row">
			<button class="au-btn" type="submit" disabled={uploading}
				>{uploading ? 'Uploading…' : 'Upload register'}</button
			>
		</div>
	</form>

	{#if data.registers.length}
		<ul class="au-list" aria-label="Risk registers">
			{#each data.registers as d (d.id)}
				<li>
					<ItemCard
						ref="Risk register{d.filename && d.filename !== d.name ? ` · ${d.filename}` : ''}"
						title={d.name}
						href="?item=artifact:{d.id}"
						badge={d.textStatus === 'extracted'
							? { label: TEXT.extracted!, tone: 'ok' }
							: { label: TEXT[d.textStatus] || 'No text', tone: 'danger' }}
						testid="register-{d.filename ?? d.name}"
					>
						{#snippet details()}
							{#if d.textStatus === 'extracted'}
								<AiAction
									action="extract_risks"
									label="Extract risks"
									context={{ artifact_id: d.id }}
									hint="Reads the register and proposes each risk with its level and the requirements it affects."
								/>
							{/if}
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.risks.length === 0 && !adding && !failed('add')}
		<div class="au-empty" data-testid="risks-empty">
			<p>
				<strong>No risks yet.</strong> Upload the auditee’s risk register above and extract its risks, record them
				by hand, or record your own view of the main risks.
			</p>
			<p>
				Risks set the default criticality of the requirements they affect, which decides how much evidence to
				plan.
			</p>
			<button class="au-btn au-btn--primary" type="button" onclick={() => (adding = true)}>Add risk</button>
		</div>
	{/if}

	{#if adding || failed('add')}
		<form method="POST" action="?/add" class="au-form au-item" use:enhance={after}>
			<RiskForm
				prefix="new"
				values={failed('add')?.values ?? {}}
				fields={failed('add')?.fields}
				requirements={data.requirements}
				scopes={data.scopes}
				{multiple}
			/>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit">Add risk</button>
				<button class="au-btn au-btn--ghost" type="button" onclick={() => (adding = false)}>Cancel</button>
			</div>
		</form>
	{/if}

	{#if proposed.length}
		<ProposalBar types={['risk']}>
			<form method="POST" action="?/acceptAll" use:enhance={after}>
				<button class="au-btn au-btn--primary au-btn--small" type="submit">Accept all</button>
			</form>
		</ProposalBar>
		<h3 class="au-section__title">Proposed ({proposed.length})</h3>
		<p class="au-muted">Proposed risks set no criticality until you accept them.</p>
		<SelectionBar
			id="select-risks"
			all={proposed.map((r) => r.id)}
			bind:selected={selectedRisks}
			acceptAction="?/acceptSelected"
			rejectAction="?/rejectSelected"
			noun={['risk', 'risks']}
		/>
		<ul class="au-list" aria-label="Proposed risks">
			{#each proposed as r (r.id)}
				<li>
					<ItemCard
						state="proposed"
						ref="{ORIGIN[r.origin] ?? r.origin} · {LEVEL[r.level] ?? r.level}{r.scopeIds.length
							? ` · ${r.scopeIds.map((s) => scopeOf.get(s)).join(', ')}`
							: ''}"
						title={r.title}
						href="?item=risk:{r.id}"
						body={[
							r.description,
							r.requirementIds.length
								? `Affects ${r.requirementIds.map((id) => refOf.get(id) ?? '(deselected)').join(', ')}`
								: 'Affects no selected requirement yet'
						]
							.filter(Boolean)
							.join(' · ')}
						version={r.version}
						testid="risk-{r.title}"
					>
						{#snippet actions()}
							{#if editing === r.id || failed('update', r.id)}
								<form method="POST" action="?/update" class="au-form au-grow" use:enhance={after}>
									<input type="hidden" name="id" value={r.id} />
									<input type="hidden" name="base_version" value={r.version} />
									<RiskForm
										prefix="edit-{r.id}"
										values={failed('update', r.id)?.values ?? asValues(r)}
										fields={failed('update', r.id)?.fields}
										requirements={data.requirements}
										scopes={data.scopes}
										{multiple}
									/>
									<div class="au-row">
										<button class="au-btn au-btn--primary au-btn--small" type="submit">Save risk</button>
										<button
											class="au-btn au-btn--ghost au-btn--small"
											type="button"
											onclick={() => (editing = null)}>Cancel</button
										>
									</div>
								</form>
							{:else}
								{#if proposed.length > 1}
									<label class="au-check-row au-select">
										<input
											type="checkbox"
											form="select-risks"
											name="ids"
											value={r.id}
											bind:group={selectedRisks}
											aria-label="Select {r.title}"
										/>
										Select
									</label>
								{/if}
								<form method="POST" action="?/accept" use:enhance={after}>
									<input type="hidden" name="id" value={r.id} />
									<button
										class="au-btn au-btn--small au-btn--primary"
										type="submit"
										aria-label="Accept {r.title}">Accept</button
									>
								</form>
								<button
									class="au-btn au-btn--small"
									type="button"
									onclick={() => (editing = r.id)}
									aria-label="Edit {r.title}">Edit</button
								>
								<form method="POST" action="?/reject" use:enhance={after}>
									<input type="hidden" name="id" value={r.id} />
									<button
										class="au-btn au-btn--small au-btn--ghost"
										type="submit"
										aria-label="Reject {r.title}">Reject</button
									>
								</form>
							{/if}
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{/if}

	<ul class="au-list" aria-label="Risks">
		{#each accepted as r (r.id)}
			<li>
				<ItemCard
					ref="{ORIGIN[r.origin] ?? r.origin}{r.scopeIds.length
						? ` · ${r.scopeIds.map((s) => scopeOf.get(s)).join(', ')}`
						: ''}"
					title={r.title}
					href="?item=risk:{r.id}"
					badge={{ label: LEVEL[r.level] ?? r.level, tone: TONE[r.level] }}
					body={r.requirementIds.length
						? `Affects ${r.requirementIds.map((id) => refOf.get(id) ?? '(deselected)').join(', ')}`
						: 'Affects no selected requirement'}
					version={r.version}
					testid="risk-{r.title}"
				>
					{#snippet actions()}
						{#if editing === r.id || failed('update', r.id)}
							<form method="POST" action="?/update" class="au-form au-grow" use:enhance={after}>
								<input type="hidden" name="id" value={r.id} />
								<input type="hidden" name="base_version" value={r.version} />
								<RiskForm
									prefix="edit-{r.id}"
									values={failed('update', r.id)?.values ?? asValues(r)}
									fields={failed('update', r.id)?.fields}
									requirements={data.requirements}
									scopes={data.scopes}
									{multiple}
								/>
								<div class="au-row">
									<button class="au-btn au-btn--primary au-btn--small" type="submit">Save risk</button>
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
								onclick={() => (editing = r.id)}
								aria-label="Edit {r.title}">Edit</button
							>
							<form method="POST" action="?/remove" use:enhance={after}>
								<input type="hidden" name="id" value={r.id} />
								<button class="au-btn au-btn--small au-btn--ghost" type="submit" aria-label="Remove {r.title}"
									>Remove</button
								>
							</form>
						{/if}
					{/snippet}
				</ItemCard>
			</li>
		{/each}
	</ul>
</section>
