<script lang="ts">
	import AiAction from '#lib/components/ai/AiAction.svelte';
	import ProposalBar from '#lib/components/ai/ProposalBar.svelte';
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';
	import PersonForm from '#lib/components/PersonForm.svelte';

	let { data, form } = $props();
	type Result = {
		message?: string;
		success?: string;
		fields?: Record<string, string>;
		values?: Record<string, string>;
	};
	const result = $derived((form ?? null) as Result | null);
	const proposed = $derived(data.people.filter((p) => p.status === 'proposed'));
	const confirmed = $derived(data.people.filter((p) => p.status === 'confirmed'));
	let adding = $state(false);
	let editing = $state<string | null>(null);
	let editingDescription = $state(false);
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
				editingDescription = false;
			}
		};
	const failed = (action: string, id?: string) =>
		result?.message && result.values?.action === action && (!id || result.values.id === id) ? result : null;
	const asValues = (p: (typeof data.people)[number]) => ({
		role: p.role,
		name: p.name ?? '',
		unit: p.unit ?? '',
		email: p.email ?? '',
		responsibilities: p.responsibilities.join('\n')
	});
</script>

<svelte:head><title>Auditee · Set-up · mcp-audit</title></svelte:head>

<FormMessage form={result} />

<AiAction
	action="derive_roles"
	label="Derive roles from documents"
	hint="Reads the auditee's documents and proposes the roles to engage with, for you to accept."
/>

<ProposalBar types={['role']}>
	<form method="POST" action="?/acceptAll" use:enhance={after}>
		<input type="hidden" name="auditee_id" value={data.auditee.id} />
		<button class="au-btn au-btn--primary au-btn--small" type="submit">Accept all</button>
	</form>
</ProposalBar>

<section class="au-section" aria-labelledby="auditee-title">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="auditee-title">{data.auditee.name}</h2>
		{#if !editingDescription && !failed('description')}
			<button class="au-btn au-btn--small" type="button" onclick={() => (editingDescription = true)}
				>Edit description</button
			>
		{/if}
	</div>
	{#if editingDescription || failed('description')}
		<form method="POST" action="?/description" class="au-form" use:enhance={after}>
			<input type="hidden" name="auditee_id" value={data.auditee.id} />
			<input type="hidden" name="base_version" value={data.auditee.version} />
			<div class="au-field">
				<label for="auditee-description">Description</label>
				<textarea
					id="auditee-description"
					name="description"
					rows="3"
					defaultValue={failed('description')?.values?.description ?? data.auditee.description ?? ''}
				></textarea>
			</div>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit">Save description</button>
				<button class="au-btn au-btn--ghost" type="button" onclick={() => (editingDescription = false)}
					>Cancel</button
				>
			</div>
		</form>
	{:else}
		<p data-testid="auditee-description">{data.auditee.description ?? 'No description yet.'}</p>
	{/if}
</section>

{#if proposed.length}
	<section class="au-section" aria-labelledby="proposed-title">
		<h2 class="au-section__title" id="proposed-title">Proposed roles ({proposed.length})</h2>
		<ul class="au-list" aria-label="Proposed roles">
			{#each proposed as p (p.id)}
				<li>
					<ItemCard
						state="proposed"
						ref={p.sourceDocument
							? `From ${p.sourceDocument}${p.sourceSection ? ` § ${p.sourceSection}` : ''}`
							: 'Proposed'}
						title={p.role}
						href="?item=person:{p.id}"
						body={p.responsibilities.join('; ') || null}
						testid="person-{p.role}"
					>
						{#snippet actions()}
							<form method="POST" action="?/accept" use:enhance={after}>
								<input type="hidden" name="id" value={p.id} />
								<button
									class="au-btn au-btn--small au-btn--primary"
									type="submit"
									aria-label="Accept {p.role}">Accept</button
								>
							</form>
							<form method="POST" action="?/reject" use:enhance={after}>
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="proposed" value="true" />
								<button class="au-btn au-btn--small au-btn--ghost" type="submit" aria-label="Reject {p.role}"
									>Reject</button
								>
							</form>
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="au-section" aria-labelledby="roles-title">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="roles-title">Roles</h2>
		{#if !adding && !failed('add')}
			<button class="au-btn" type="button" onclick={() => (adding = true)}>Add person</button>
		{/if}
	</div>
	{#if adding || failed('add')}
		<form method="POST" action="?/add" class="au-form au-item" use:enhance={after}>
			<input type="hidden" name="auditee_id" value={data.auditee.id} />
			<PersonForm prefix="new" values={failed('add')?.values ?? {}} fields={failed('add')?.fields} />
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit">Add person</button>
				<button class="au-btn au-btn--ghost" type="button" onclick={() => (adding = false)}>Cancel</button>
			</div>
		</form>
	{/if}
	{#if confirmed.length === 0}
		<div class="au-empty">
			<p>No roles yet. Add the people the audit will talk to; only the role is required.</p>
		</div>
	{/if}
	<ul class="au-list" aria-label="Roles">
		{#each confirmed as p (p.id)}
			<li>
				<ItemCard
					ref={[p.name, p.unit, p.email].filter(Boolean).join(' · ') || 'No name yet'}
					title={p.role}
					href="?item=person:{p.id}"
					body={p.responsibilities.join('; ') || null}
					version={p.version}
					testid="person-{p.role}"
				>
					{#snippet actions()}
						{#if editing === p.id || failed('update', p.id)}
							<form method="POST" action="?/update" class="au-form au-grow" use:enhance={after}>
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="base_version" value={p.version} />
								<PersonForm
									prefix="edit-{p.id}"
									values={failed('update', p.id)?.values ?? asValues(p)}
									fields={failed('update', p.id)?.fields}
								/>
								<div class="au-row">
									<button class="au-btn au-btn--primary au-btn--small" type="submit">Save person</button>
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
								onclick={() => (editing = p.id)}
								aria-label="Edit {p.role}">Edit</button
							>
							<form method="POST" action="?/reject" use:enhance={after}>
								<input type="hidden" name="id" value={p.id} />
								<button class="au-btn au-btn--small au-btn--ghost" type="submit" aria-label="Remove {p.role}"
									>Remove</button
								>
							</form>
						{/if}
					{/snippet}
				</ItemCard>
			</li>
		{/each}
	</ul>
	<p class="au-muted">
		Roles named in the auditee’s documents can be proposed by Claude through the set-up skill; they appear
		above for you to accept or reject.
	</p>
</section>
