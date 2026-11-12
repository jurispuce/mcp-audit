<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import LanguageSelect from '#lib/components/LanguageSelect.svelte';
	import StaleNotice from '#lib/components/StaleNotice.svelte';

	let { data, form } = $props();
	type Result = {
		message?: string;
		success?: string;
		fields?: Record<string, string>;
		values?: Record<string, unknown>;
		conflict?: { version: number; current: Record<string, unknown>; attempted: Record<string, unknown> };
	};
	const result = $derived((form ?? null) as Result | null);
	const o = $derived(data.overview);
	const e = $derived(o.engagement);
	const base = $derived(`/e/${e.id}`);
	let redoing = $state(false);
	let editing = $state(false);
	const LABELS = {
		name: 'Engagement name',
		start_date: 'Start date',
		end_date: 'End date',
		working_language: 'Working language',
		report_language: 'Report language',
		description: 'Description'
	};
	const current = $derived<Record<string, unknown>>({
		name: e.name,
		start_date: e.startDate,
		end_date: e.endDate ?? '',
		working_language: e.workingLanguage,
		report_language: e.reportLanguage,
		description: e.description ?? '',
		ai_allowed: e.aiAllowed
	});
	const shown = $derived<Record<string, unknown>>(
		result?.conflict
			? redoing
				? result.conflict.attempted
				: current
			: result?.message
				? (result.values ?? current)
				: current
	);
	const f = $derived(result?.fields ?? {});
	const s = (k: string) => String(shown[k] ?? '');
	const doneCount = $derived(o.phases.filter((p) => p.done).length);
</script>

<svelte:head><title>Home · {e.name} · mcp-audit</title></svelte:head>

<section class="au-screen">
	<header class="au-screen__head">
		<span class="au-ref">{e.auditeeName} · {e.startDate}{e.endDate ? ` to ${e.endDate}` : ''}</span>
		<h1 class="au-screen__title">{e.name}</h1>
	</header>

	<section class="au-section" aria-labelledby="phases-title">
		<div class="au-row au-between">
			<h2 class="au-section__title" id="phases-title">Phases</h2>
			<span class="au-muted">{doneCount} of 8 done</span>
		</div>
		<ol class="au-phases" data-testid="phases">
			{#each o.phases as p (p.number)}
				<li>
					<a
						class="au-phase"
						class:au-phase--done={p.state === 'done'}
						class:au-phase--current={p.state === 'current'}
						href="{base}{p.href}"
						data-state={p.state}
						aria-current={p.state === 'current' ? 'step' : undefined}
					>
						<span class="au-phase__dot" aria-hidden="true">{p.state === 'done' ? '✓' : p.number}</span>
						<span class="au-phase__name"
							>{p.title}<span class="au-visually-hidden"
								>, {p.state === 'done' ? 'done' : p.state === 'current' ? 'next' : 'to do'}</span
							></span
						>
						<span class="au-muted au-phase__fact">{p.fact}</span>
					</a>
				</li>
			{/each}
		</ol>
		{#if o.current}
			<a class="au-btn au-btn--primary" href="{base}{o.current.href}" data-testid="continue"
				>Continue: {o.current.next}</a
			>
		{/if}
	</section>

	<section class="au-section" aria-labelledby="details-title">
		<div class="au-row au-between">
			<h2 class="au-section__title" id="details-title">Engagement details</h2>
			<span class="au-row">
				<a
					class="au-btn au-btn--ghost au-btn--small"
					href="?item=engagement:{e.id}&tab=history"
					data-sveltekit-reset="false">History</a
				>
				{#if !editing && !result?.message}
					<button class="au-btn au-btn--small" type="button" onclick={() => (editing = true)}
						>Edit details</button
					>
				{/if}
			</span>
		</div>
		{#if result?.conflict}
			<StaleNotice
				conflict={result.conflict}
				labels={LABELS}
				{redoing}
				onredo={() => (redoing = true)}
				onkeep={() => (redoing = false)}
			/>
		{:else}
			<FormMessage form={result} />
		{/if}
		{#if editing || result?.message}
			{#key `${shown.name}-${redoing}-${result?.conflict?.version}`}
				<form
					method="POST"
					action="?/details"
					class="au-form au-item"
					use:enhance={() =>
						async ({ result: r, update }) => {
							redoing = false;
							await update({ reset: false });
							if (r.type === 'success') editing = false;
						}}
				>
					<input
						type="hidden"
						name="base_version"
						value={result?.conflict ? result.conflict.version : e.version}
					/>
					<Field label="Engagement name" name="name" required value={s('name')} error={f.name} />
					<Field
						label="Start date"
						name="start_date"
						type="date"
						required
						value={s('start_date')}
						error={f.start_date}
					/>
					<Field
						label="End date (optional)"
						name="end_date"
						type="date"
						value={s('end_date')}
						error={f.end_date}
					/>
					<LanguageSelect label="Working language" name="working_language" value={s('working_language')} />
					<LanguageSelect label="Report language" name="report_language" value={s('report_language')} />
					<div class="au-field">
						<label for="f-description">Description</label>
						<textarea id="f-description" name="description" rows="3" defaultValue={s('description')}
						></textarea>
					</div>
					<label class="au-check-row">
						<input type="checkbox" name="ai_allowed" checked={shown.ai_allowed === true} />
						AI may work on this engagement
					</label>
					<div class="au-row">
						<button class="au-btn au-btn--primary" type="submit">Save details</button>
						<button
							class="au-btn au-btn--ghost"
							type="button"
							onclick={() => {
								editing = false;
								form = null;
							}}>Cancel</button
						>
					</div>
				</form>
			{/key}
		{:else}
			<dl class="au-dl" data-testid="engagement-details">
				<dt>Auditee</dt>
				<dd>{e.auditeeName}</dd>
				<dt>Dates</dt>
				<dd>{e.startDate}{e.endDate ? ` to ${e.endDate}` : ', no end date'}</dd>
				<dt>Languages</dt>
				<dd>Working {e.workingLanguage.toUpperCase()}, report {e.reportLanguage.toUpperCase()}</dd>
				<dt>AI</dt>
				<dd>{e.aiAllowed ? 'Allowed' : 'Switched off'}</dd>
				{#if e.description}<dt>Description</dt>
					<dd>{e.description}</dd>{/if}
				<dt>Version</dt>
				<dd>v{e.version}</dd>
			</dl>
		{/if}
	</section>
</section>
