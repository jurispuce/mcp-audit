<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import AutoSubmit from '#lib/components/AutoSubmit.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import SoaPanel from '#lib/components/setup/SoaPanel.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';

	let { data, form } = $props();
	const selectedIds = $derived(new Set(data.selected.map((s) => s.requirementId)));
	const multiple = $derived(data.engagement.scopeMode === 'multiple');
	const LEVEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) =>
			update({ reset: false });
	let filter = $state('');

	/** Role labels by source code, for the selected requirements (#110). */
	const roleLabels = $derived(
		new Map(data.sources.map((s) => [s.code, new Map(s.roles.map((r) => [r.key, r.label]))]))
	);
	const appliesLine = (code: string, keys: string[]) =>
		keys.length ? keys.map((k) => roleLabels.get(code)?.get(k) ?? k).join(', ') : '';
	/** This page's address with one source's role set or cleared. */
	function roleHref(code: string, role: string | null): string {
		const u = new URL(page.url.href);
		if (role) u.searchParams.set(`role.${code}`, role);
		else u.searchParams.delete(`role.${code}`);
		return `${u.pathname}${u.search}`;
	}
	/** A form action that keeps this page's query (the roles chosen), so the page comes back as it was. */
	const act = (name: string) => {
		const q = page.url.searchParams.toString();
		return q ? `?${q}&/${name}` : `?/${name}`;
	};
	const applies = (roles: string[], role: string | null) =>
		!role || roles.length === 0 || roles.includes(role);
</script>

<svelte:head><title>Requirements · Set-up · {page.data.instance}</title></svelte:head>

<FormMessage form={form as { message?: string; success?: string } | null} />

<SoaPanel check={data.soa} />

<section class="au-section" aria-labelledby="selected-title">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="selected-title">Selected requirements</h2>
		<span class="au-muted" data-testid="units-count"
			>{data.selected.length} selected · {data.units} assessment {data.units === 1 ? 'unit' : 'units'}</span
		>
	</div>
	{#if data.selected.length === 0}
		<div class="au-empty"><p>Nothing selected yet. Choose requirements from the library below.</p></div>
	{:else}
		<ul class="au-list" aria-label="Selected requirements">
			{#each data.selected as s (s.id)}
				<li>
					<ItemCard
						ref="{s.refCode} · {s.sourceCode}{s.appliesTo.length
							? ` · ${appliesLine(s.sourceCode, s.appliesTo)}`
							: ''} · pinned v{s.pinned.version}"
						title={s.pinned.title}
						href="?item=engagement_requirement:{s.id}"
						badge={{
							label: `${LEVEL[s.crit.level]} criticality`,
							tone: s.crit.level === 'high' ? 'danger' : s.crit.level === 'medium' ? 'warn' : 'neutral'
						}}
						body={s.pinned.text}
						version={s.version}
						testid="selected-{s.refCode}"
					>
						{#snippet meta()}
							<span class="au-muted">
								{s.crit.from === 'risk'
									? `From risks: ${s.crit.risks.join(', ')}`
									: s.crit.from === 'override'
										? 'Set by the auditor'
										: 'Default: no linked risk'}
							</span>
						{/snippet}
						{#snippet actions()}
							{#if multiple}
								<form method="POST" action={act('handling')} use:enhance={keep}>
									<input type="hidden" name="requirement" value={s.requirementId} />
									<AutoSubmit
										label="Findings"
										name="handling"
										value={s.scopeHandling}
										options={[
											['common', 'One finding'],
											['per_scope', 'Per scope']
										]}
										testid="handling-{s.refCode}"
									/>
								</form>
							{/if}
							<form method="POST" action={act('criticality')} use:enhance={keep}>
								<input type="hidden" name="requirement" value={s.requirementId} />
								<AutoSubmit
									label="Criticality"
									name="criticality"
									value={s.crit.from === 'override' ? s.crit.level : ''}
									options={[
										[
											'',
											`From risks (${LEVEL[s.crit.from === 'override' ? 'medium' : s.crit.level]?.toLowerCase()})`
										],
										['high', 'High'],
										['medium', 'Medium'],
										['low', 'Low']
									]}
									testid="criticality-{s.refCode}"
								/>
							</form>
							{#if s.newerVersion}
								<form method="POST" action={act('upgrade')} use:enhance={keep}>
									<input type="hidden" name="requirement" value={s.requirementId} />
									<button class="au-btn au-btn--small" type="submit">Use library v{s.newerVersion}</button>
								</form>
							{/if}
							<form method="POST" action={act('deselect')} use:enhance={keep}>
								<input type="hidden" name="requirement" value={s.requirementId} />
								<button
									class="au-btn au-btn--small au-btn--ghost"
									type="submit"
									aria-label="Deselect {s.refCode}">Deselect</button
								>
							</form>
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="au-section" aria-labelledby="library-title">
	<h2 class="au-section__title" id="library-title">Add from the library</h2>
	<div class="au-field">
		<label for="req-filter">Filter</label>
		<input id="req-filter" type="search" placeholder="Code or title" bind:value={filter} autocomplete="off" />
	</div>
	{#each data.sources as src (src.id)}
		{@const shown = src.items.filter((r) => applies(r.roles, src.role))}
		{@const roleLabel = src.roles.find((r) => r.key === src.role)?.label}
		<details class="au-item" open data-testid="select-source-{src.code}">
			<summary
				><strong>{src.title}</strong>
				<span class="au-muted"
					>· {src.code}{roleLabel ? ` · ${roleLabel}` : ''} · {shown.filter((r) => selectedIds.has(r.id))
						.length} of {shown.length}
					selected</span
				></summary
			>
			{#if src.roles.length}
				<nav class="au-row au-wrap au-rolefilter" aria-label="Applies to, in {src.code}">
					<span class="au-muted">Applies to</span>
					<a
						class="au-btn au-btn--small"
						class:au-btn--primary={!src.role}
						href={roleHref(src.code, null)}
						aria-current={!src.role ? 'true' : undefined}
						data-sveltekit-noscroll
						data-sveltekit-replacestate>All roles</a
					>
					{#each src.roles as role (role.key)}
						<a
							class="au-btn au-btn--small"
							class:au-btn--primary={src.role === role.key}
							href={roleHref(src.code, role.key)}
							aria-current={src.role === role.key ? 'true' : undefined}
							title={role.description ?? undefined}
							data-sveltekit-noscroll
							data-sveltekit-replacestate>{role.label}</a
						>
					{/each}
				</nav>
			{/if}
			<form method="POST" action={act('select')} class="au-stack" use:enhance>
				{#if src.role}<input type="hidden" name="role" value={src.role} />{/if}
				<ul class="au-list au-checklist" aria-label="{src.title} requirements">
					{#each shown as r (r.id)}
						{@const hidden =
							!!filter && !`${r.refCode} ${r.title}`.toLowerCase().includes(filter.toLowerCase())}
						<li style:padding-left="{r.depth * 1.25}rem" {hidden}>
							<label class="au-check-row">
								<input
									type="checkbox"
									name="requirement"
									value={r.id}
									checked={selectedIds.has(r.id)}
									disabled={selectedIds.has(r.id)}
								/>
								<span><span class="au-ref">{r.refCode}</span> {r.title}</span>
							</label>
						</li>
					{/each}
				</ul>
				<div class="au-row">
					<button class="au-btn au-btn--primary" type="submit">Select ticked</button>
					<button class="au-btn" type="submit" name="all_of" value={src.id}
						>Select all in {src.code}{roleLabel ? ` for ${roleLabel}` : ''}</button
					>
				</div>
			</form>
		</details>
	{:else}
		<div class="au-empty"><p>The library is empty. <a href="/library">Import a source</a> first.</p></div>
	{/each}
</section>

<section class="au-section" aria-labelledby="internal-title">
	<h2 class="au-section__title" id="internal-title">Internal requirements</h2>
	{#if data.internal.length}
		<ul class="au-list" aria-label="Internal requirements">
			{#each data.internal as r (r.id)}
				<li>
					<ItemCard
						ref="{r.refCode} · {r.sourceTitle}{r.section ? ` § ${r.section}` : ''}"
						title={r.title}
						href="?item=requirement:{r.id}"
						body={r.implements.length
							? `Implements ${r.implements.map((l) => `${l.other.refCode} (${l.coverage})`).join(', ')}`
							: 'Implements nothing yet'}
					/>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="au-muted">None confirmed yet. They come from the auditee’s documents.</p>
		<a class="au-btn" href="/e/{data.engagement.id}/setup/documents">Go to Documents</a>
	{/if}
</section>
