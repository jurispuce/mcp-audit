<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';
	import LanguageSelect from '#lib/components/LanguageSelect.svelte';

	let { data, form } = $props();
	type Result = { message?: string; fields?: Record<string, string>; values?: Record<string, string> };
	const result = $derived((form ?? null) as Result | null);
	let creating = $state(false);
	const open = $derived(creating || !!result?.message || data.engagements.length === 0);
	const v = $derived(result?.values ?? {});
	const f = $derived(result?.fields ?? {});
	const PLAN: Record<string, string> = { draft: 'Plan draft', sent: 'Plan sent', agreed: 'Plan agreed' };
</script>

<svelte:head><title>Engagements · mcp-audit</title></svelte:head>

<section class="au-screen">
	<header class="au-screen__head au-row au-between">
		<h1 class="au-screen__title">Engagements</h1>
		{#if !open}
			<button class="au-btn au-btn--primary" type="button" onclick={() => (creating = true)}
				>Create engagement</button
			>
		{/if}
	</header>

	{#if data.atLabel && data.engagements.length}
		<p class="au-muted">Choose an engagement to open its {data.atLabel}.</p>
	{/if}

	{#if open}
		<form method="POST" action="?/create" class="au-form au-item" use:enhance aria-labelledby="create-title">
			<h2 class="au-section__title" id="create-title">Create engagement</h2>
			<FormMessage form={result} />
			<Field
				label="Engagement name"
				name="name"
				required
				value={v.name ?? ''}
				error={f.name}
				placeholder="NIS 2 audit, Riga office"
			/>
			<Field
				label="Auditee"
				name="auditee"
				required
				value={v.auditee ?? ''}
				error={f.auditee}
				list="auditees"
				autocomplete="off"
			/>
			<datalist id="auditees">
				{#each data.auditees as a (a)}<option value={a}></option>{/each}
			</datalist>
			<Field
				label="Start date"
				name="start_date"
				type="date"
				required
				value={v.start_date ?? data.today}
				error={f.start_date}
			/>
			<Field
				label="End date (optional)"
				name="end_date"
				type="date"
				value={v.end_date ?? ''}
				error={f.end_date}
			/>
			<LanguageSelect label="Working language" name="working_language" value={v.working_language || 'en'} />
			<LanguageSelect label="Report language" name="report_language" value={v.report_language || 'en'} />
			<div class="au-field">
				<label for="f-description">Description (optional)</label>
				<textarea id="f-description" name="description" rows="3" defaultValue={v.description ?? ''}
				></textarea>
			</div>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit">Create engagement</button>
				{#if data.engagements.length}
					<button class="au-btn au-btn--ghost" type="button" onclick={() => (creating = false)}>Cancel</button
					>
				{/if}
			</div>
		</form>
	{/if}

	{#if data.engagements.length}
		<ul class="au-list" aria-label="Engagements">
			{#each data.engagements as e (e.id)}
				<li>
					<ItemCard
						ref="{e.auditeeName} · {e.startDate}{e.endDate ? ` to ${e.endDate}` : ''}"
						title={e.name}
						href="/e/{e.id}{data.at}"
						badge={{
							label: PLAN[e.planStatus] ?? e.planStatus,
							tone: e.planStatus === 'agreed' ? 'ok' : 'neutral'
						}}
						body={e.description}
						testid="engagement-{e.id}"
					/>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="au-empty" data-testid="engagements-empty">
			<p>No engagements yet. Create the first one above.</p>
		</div>
	{/if}

	<nav class="au-phone-only au-list" aria-label="More">
		<a class="au-btn" href="/library">Library</a>
		<a class="au-btn" href="/settings">Settings</a>
	</nav>
</section>
