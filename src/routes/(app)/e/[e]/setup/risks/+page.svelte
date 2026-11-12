<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
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
			await update({ reset: false });
			if (r.type === 'success') {
				adding = false;
				editing = null;
			}
		};
	const LEVEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
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

<svelte:head><title>Risks · Set-up · mcp-audit</title></svelte:head>

<FormMessage form={result} />

<section class="au-section" aria-labelledby="risks-title">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="risks-title">Risks</h2>
		{#if !adding && !failed('add') && data.risks.length}
			<button class="au-btn" type="button" onclick={() => (adding = true)}>Add risk</button>
		{/if}
	</div>

	{#if data.risks.length === 0 && !adding && !failed('add')}
		<div class="au-empty" data-testid="risks-empty">
			<p>
				<strong>No risks yet.</strong> Ask the auditee for its risk register and record its risks here, or record
				your own view of the main risks.
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

	<ul class="au-list" aria-label="Risks">
		{#each data.risks as r (r.id)}
			<li>
				<ItemCard
					ref="{r.origin === 'auditee_register' ? 'Auditee register' : 'Auditor view'}{r.scopeIds.length
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
