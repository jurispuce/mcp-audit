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
	type Msg = { ok: boolean; text: string } | null;
	let guidanceMsg = $state<Msg>(null);
	let criteriaMsg = $state<Msg>(null);
	let editMsg = $state<Msg>(null);

	/**
	 * What someone typed but has not saved yet stays in this browser tab (sessionStorage), so closing
	 * the panel or reloading the page does not lose it. It is cleared once saved.
	 */
	const draftKey = (what: string) => `mcpa:draft:${what}:${extra.requirement.id}`;
	function readDraft(what: string): string | null {
		try {
			return sessionStorage.getItem(draftKey(what));
		} catch {
			return null;
		}
	}
	function writeDraft(what: string, value: string) {
		try {
			if (value.trim()) sessionStorage.setItem(draftKey(what), value);
			else sessionStorage.removeItem(draftKey(what));
		} catch {
			// storage unavailable: the draft lives only as long as the panel
		}
	}

	// Guidance: its own versioned item, edited here.
	// The draft resets to the stored guidance whenever the sheet reloads, unless an unsaved draft exists.
	let guidance = $derived(readDraft('guidance') ?? extra.guidance?.body ?? '');
	const guidanceChanged = $derived(guidance !== (extra.guidance?.body ?? ''));

	async function saveGuidance(e: SubmitEvent) {
		e.preventDefault();
		const res = await api('PUT', `/api/library/requirements/${extra.requirement.id}/guidance`, {
			body: guidance,
			baseVersion: extra.guidance?.version ?? null
		});
		if (!res.ok) {
			guidanceMsg = {
				ok: false,
				text:
					res.status === 409
						? 'Someone else changed the guidance while you were editing. Your text is kept below; check their version in History and save again.'
						: (res.message ?? 'Could not save the guidance.')
			};
			return;
		}
		writeDraft('guidance', '');
		guidanceMsg = { ok: true, text: 'Guidance saved.' };
		await onchange();
	}

	// Criteria
	let newText = $state(readDraft('criterion') ?? '');
	let newEvidence = $state(readDraft('criterion-evidence') ?? '');
	const restoredDraft = !!(readDraft('criterion') || readDraft('guidance'));
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
			criteriaMsg = { ok: false, text: res.message ?? 'Could not save the criterion.' };
			return;
		}
		newText = '';
		newEvidence = '';
		writeDraft('criterion', '');
		writeDraft('criterion-evidence', '');
		criteriaMsg = { ok: true, text: 'Criterion saved. It is listed above.' };
		await onchange();
	}

	function startEdit(c: RequirementExtra['criteria'][number]) {
		editMsg = null;
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
		editMsg = res.ok ? null : { ok: false, text: res.message ?? 'Could not save the criterion.' };
		if (res.ok) {
			editing = null;
			criteriaMsg = { ok: true, text: 'Criterion saved.' };
		}
		await onchange();
	}

	async function removeCriterion(c: RequirementExtra['criteria'][number]) {
		if (!confirm('Remove this criterion? It stays in the history.')) return;
		const res = await api('POST', `/api/library/criteria/${c.id}/remove`, { baseVersion: c.version });
		criteriaMsg = res.ok
			? { ok: true, text: 'Criterion removed. It stays in the history.' }
			: { ok: false, text: res.message ?? 'Could not remove the criterion.' };
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
	{#if restoredDraft}
		<div class="au-alert au-alert--info" data-testid="draft-restored">
			Text you typed here earlier and did not save is back below. Save it, or clear it.
		</div>
	{/if}

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
				<textarea
					id="guidance-body"
					class="au-textarea--grow"
					bind:value={guidance}
					oninput={() => {
						guidanceMsg = null;
						writeDraft('guidance', guidanceChanged ? guidance : '');
					}}></textarea>
			</div>
			<div class="au-row au-wrap">
				<button
					class="au-btn {guidanceChanged ? 'au-btn--primary' : ''}"
					type="submit"
					disabled={!guidanceChanged}>Save guidance</button
				>
				{#if guidanceChanged}<span class="au-unsaved">Not saved yet</span>{/if}
				{#if extra.guidance}<span class="au-muted" data-testid="guidance-meta"
						>Guidance version {extra.guidance.version}{#if extra.guidance.by}&nbsp;· {extra.guidance
								.by}{/if}{#if extra.guidance.at}&nbsp;·
							{formatWhen(extra.guidance.at)}{/if}</span
					>{/if}
				{#if guidanceMsg}<span
						class={guidanceMsg.ok ? 'au-muted' : 'au-field__error'}
						role={guidanceMsg.ok ? 'status' : 'alert'}>{guidanceMsg.text}</span
					>{/if}
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
							{#if editMsg}<p class="au-field__error" role="alert">{editMsg.text}</p>{/if}
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
		{#if criteriaMsg}<p
				class={criteriaMsg.ok ? 'au-muted' : 'au-field__error'}
				role={criteriaMsg.ok ? 'status' : 'alert'}
				data-testid="criteria-message"
			>
				{criteriaMsg.text}
			</p>{/if}
		<form class="au-stack au-item" onsubmit={addCriterion} aria-label="Add criterion">
			<div class="au-field">
				<label for="cr-new">New criterion</label>
				<textarea
					id="cr-new"
					class="au-textarea--grow"
					bind:value={newText}
					oninput={() => {
						criteriaMsg = null;
						writeDraft('criterion', newText);
					}}
					placeholder="What the evidence must show"></textarea>
			</div>
			<div class="au-field">
				<label for="cr-new-ev">Expected evidence, one per line</label>
				<textarea
					id="cr-new-ev"
					bind:value={newEvidence}
					oninput={() => writeDraft('criterion-evidence', newEvidence)}></textarea>
			</div>
			<div class="au-row au-wrap">
				<button
					class="au-btn {newText.trim() ? 'au-btn--primary' : ''}"
					type="submit"
					disabled={!newText.trim()}>Save new criterion</button
				>
				{#if newText.trim()}<span class="au-unsaved">Not saved yet</span>{:else}<span class="au-muted"
						>Write the criterion, then save it.</span
					>{/if}
				{#if newText.trim() || newEvidence.trim()}
					<button
						class="au-btn au-btn--ghost"
						type="button"
						onclick={() => {
							newText = '';
							newEvidence = '';
							writeDraft('criterion', '');
							writeDraft('criterion-evidence', '');
						}}>Clear</button
					>
				{/if}
			</div>
		</form>
	</section>
</div>
