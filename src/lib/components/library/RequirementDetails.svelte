<script lang="ts">
	import { api } from '#lib/api.ts';
	import { formatWhen } from '#lib/format.ts';
	import RequirementPicker from './RequirementPicker.svelte';
	import type { RequirementExtra } from './types';

	interface Props {
		extra: RequirementExtra;
		onchange: () => Promise<void> | void;
		onopen: (key: string) => void;
	}
	let { extra, onchange, onopen }: Props = $props();

	let error = $state<string | null>(null);

	// Guidance: its own versioned item, edited here.
	// The draft resets to the stored guidance whenever the sheet reloads.
	let guidance = $derived(extra.guidance?.body ?? '');
	let guidanceSaved = $state<string | null>(null);

	async function saveGuidance(e: SubmitEvent) {
		e.preventDefault();
		const res = await api('PUT', `/api/library/requirements/${extra.requirement.id}/guidance`, {
			body: guidance,
			baseVersion: extra.guidance?.version ?? null
		});
		if (!res.ok) {
			error =
				res.status === 409
					? 'Someone else changed the guidance while you were editing. It now shows their version; redo your change on top of it.'
					: res.message;
			await onchange();
			return;
		}
		error = null;
		guidanceSaved = 'Guidance saved.';
		await onchange();
	}

	// Criteria
	let newText = $state('');
	let newEvidence = $state('');
	let editing = $state<string | null>(null);
	let editText = $state('');
	let editEvidence = $state('');

	async function addCriterion(e: SubmitEvent) {
		e.preventDefault();
		const res = await api('POST', `/api/library/requirements/${extra.requirement.id}/criteria`, {
			text: newText,
			expectedEvidence: newEvidence
		});
		if (!res.ok) {
			error = res.message;
			return;
		}
		error = null;
		newText = '';
		newEvidence = '';
		await onchange();
	}

	function startEdit(c: RequirementExtra['criteria'][number]) {
		editing = c.id;
		editText = c.text;
		editEvidence = c.expectedEvidence.join('\n');
	}

	async function saveCriterion(c: RequirementExtra['criteria'][number]) {
		const res = await api('PATCH', `/api/library/criteria/${c.id}`, {
			text: editText,
			expectedEvidence: editEvidence,
			baseVersion: c.version
		});
		error = res.ok ? null : res.message;
		if (res.ok) editing = null;
		await onchange();
	}

	async function removeCriterion(c: RequirementExtra['criteria'][number]) {
		if (!confirm('Remove this criterion? It stays in the history.')) return;
		const res = await api('POST', `/api/library/criteria/${c.id}/remove`, { baseVersion: c.version });
		error = res.ok ? null : res.message;
		await onchange();
	}

	// Translations
	let pairing = $state(false);
	async function setTranslation(targetId: string | null) {
		const res = await api('PUT', `/api/library/requirements/${extra.requirement.id}/translation`, {
			translationOf: targetId,
			baseVersion: extra.requirement.version
		});
		error = res.ok ? null : res.message;
		if (res.ok) pairing = false;
		await onchange();
	}
</script>

<div class="au-stack" data-testid="requirement-details">
	{#if error}<div class="au-alert au-alert--danger" role="alert">{error}</div>{/if}

	<dl class="au-dl">
		<dt>Source</dt>
		<dd>{extra.requirement.sourceTitle}</dd>
		{#if extra.parent}
			<dt>Part of</dt>
			<dd>
				<button type="button" class="au-linkbtn" onclick={() => onopen(`requirement:${extra.parent!.id}`)}>
					{extra.parent.refCode} · {extra.parent.title}
				</button>
			</dd>
		{/if}
	</dl>

	<section class="au-section" aria-labelledby="tr-title" data-testid="translations">
		<h3 class="au-section__title" id="tr-title">Language versions</h3>
		{#if extra.translations.length === 0}
			<p class="au-muted">Only in {extra.requirement.language.toUpperCase()}.</p>
		{:else}
			<div class="au-versions">
				<article class="au-version">
					<span class="au-badge au-badge--info">{extra.requirement.language.toUpperCase()}</span>
					<strong>{extra.requirement.title}</strong>
					{#if extra.requirement.text}<p class="au-comment__body">{extra.requirement.text}</p>{/if}
				</article>
				{#each extra.translations as t (t.id)}
					<article class="au-version">
						<span class="au-badge">{t.language.toUpperCase()}</span>
						<button type="button" class="au-linkbtn" onclick={() => onopen(`requirement:${t.id}`)}
							>{t.title}</button
						>
						{#if t.text}<p class="au-comment__body">{t.text}</p>{/if}
					</article>
				{/each}
			</div>
		{/if}
		{#if pairing}
			<RequirementPicker
				label="Find the same requirement in another language"
				excludeId={extra.requirement.id}
				onpick={(r) => setTranslation(r.id)}
			/>
			<div>
				<button type="button" class="au-btn au-btn--ghost" onclick={() => (pairing = false)}>Cancel</button>
			</div>
		{:else}
			<div class="au-row">
				<button type="button" class="au-btn" onclick={() => (pairing = true)}>Pair with a translation</button>
				{#if extra.requirement.translationOf}
					<button type="button" class="au-btn au-btn--ghost" onclick={() => setTranslation(null)}
						>Unpair</button
					>
				{/if}
			</div>
		{/if}
	</section>

	<section class="au-section" aria-labelledby="gd-title">
		<h3 class="au-section__title" id="gd-title">Guidance</h3>
		<form class="au-stack" onsubmit={saveGuidance}>
			<div class="au-field">
				<label for="guidance-body">How to audit this requirement</label>
				<textarea id="guidance-body" bind:value={guidance} oninput={() => (guidanceSaved = null)}></textarea>
			</div>
			<div class="au-row">
				<button class="au-btn" type="submit" disabled={guidance === (extra.guidance?.body ?? '')}
					>Save guidance</button
				>
				{#if extra.guidance}<span class="au-muted" data-testid="guidance-meta"
						>Guidance version {extra.guidance.version}{#if extra.guidance.by}&nbsp;· {extra.guidance
								.by}{/if}{#if extra.guidance.at}&nbsp;·
							{formatWhen(extra.guidance.at)}{/if}</span
					>{/if}
				{#if guidanceSaved}<span class="au-muted" role="status">{guidanceSaved}</span>{/if}
			</div>
		</form>
	</section>

	<section class="au-section" aria-labelledby="cr-title" data-testid="criteria">
		<h3 class="au-section__title" id="cr-title">General criteria</h3>
		{#if extra.criteria.length === 0}<p class="au-muted">No criteria yet.</p>{/if}
		<ol class="au-criteria">
			{#each extra.criteria as c (c.id)}
				<li>
					{#if editing === c.id}
						<div class="au-stack">
							<div class="au-field">
								<label for="cr-text-{c.id}">Criterion</label>
								<textarea id="cr-text-{c.id}" bind:value={editText}></textarea>
							</div>
							<div class="au-field">
								<label for="cr-ev-{c.id}">Expected evidence, one per line</label>
								<textarea id="cr-ev-{c.id}" bind:value={editEvidence}></textarea>
							</div>
							<div class="au-row">
								<button class="au-btn au-btn--primary" type="button" onclick={() => saveCriterion(c)}
									>Save criterion</button
								>
								<button class="au-btn au-btn--ghost" type="button" onclick={() => (editing = null)}
									>Cancel</button
								>
							</div>
						</div>
					{:else}
						<p>{c.text}</p>
						{#if c.by}<p class="au-muted">{c.by}</p>{/if}
						{#if c.expectedEvidence.length}
							<p class="au-muted">Expected evidence:</p>
							<ul class="au-evidence-list">
								{#each c.expectedEvidence as ev, i (i)}<li>{ev}</li>{/each}
							</ul>
						{/if}
						<div class="au-row">
							<button class="au-btn au-btn--ghost" type="button" onclick={() => startEdit(c)}
								>Edit criterion</button
							>
							<button class="au-btn au-btn--ghost" type="button" onclick={() => removeCriterion(c)}
								>Remove criterion</button
							>
						</div>
					{/if}
				</li>
			{/each}
		</ol>
		<form class="au-stack" onsubmit={addCriterion} aria-label="Add criterion">
			<div class="au-field">
				<label for="cr-new">New criterion</label>
				<textarea id="cr-new" bind:value={newText} placeholder="What the evidence must show"></textarea>
			</div>
			<div class="au-field">
				<label for="cr-new-ev">Expected evidence, one per line</label>
				<textarea id="cr-new-ev" bind:value={newEvidence}></textarea>
			</div>
			<div><button class="au-btn" type="submit" disabled={!newText.trim()}>Add criterion</button></div>
		</form>
	</section>
</div>
