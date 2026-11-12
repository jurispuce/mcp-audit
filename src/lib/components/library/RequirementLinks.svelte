<script lang="ts">
	import { api } from '#lib/api.ts';
	import RequirementPicker from './RequirementPicker.svelte';
	import type { RequirementExtra, Requirement } from './types';

	interface Props {
		extra: RequirementExtra;
		onchange: () => Promise<void> | void;
		onopen: (key: string) => void;
	}
	let { extra, onchange, onopen }: Props = $props();

	/** Each choice reads from this requirement's point of view; "in" choices store the link the other way. */
	const CHOICES = [
		{ value: 'implements:out', label: 'Implements', type: 'implements', dir: 'out' },
		{ value: 'implements:in', label: 'Implemented by', type: 'implements', dir: 'in' },
		{ value: 'details:out', label: 'Details', type: 'details', dir: 'out' },
		{ value: 'details:in', label: 'Detailed by', type: 'details', dir: 'in' },
		{ value: 'explains:out', label: 'Explains', type: 'explains', dir: 'out' },
		{ value: 'explains:in', label: 'Explained by', type: 'explains', dir: 'in' },
		{ value: 'equivalent:out', label: 'Equivalent to', type: 'equivalent', dir: 'out' },
		{ value: 'conflicts:out', label: 'Conflicts with', type: 'conflicts', dir: 'out' }
	] as const;

	let adding = $state(false);
	let choice = $state<string>('implements:out');
	let target = $state<Requirement | null>(null);
	let coverage = $state<'full' | 'partial'>('full');
	let note = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	const chosen = $derived(CHOICES.find((c) => c.value === choice)!);
	const groups = $derived(
		[...new Set(extra.links.map((l) => l.label))].map((label) => ({
			label,
			links: extra.links.filter((l) => l.label === label)
		}))
	);

	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (!target) return;
		busy = true;
		const me = extra.requirement.id;
		const res = await api('POST', '/api/library/links', {
			fromId: chosen.dir === 'out' ? me : target.id,
			toId: chosen.dir === 'out' ? target.id : me,
			type: chosen.type,
			coverage: chosen.type === 'implements' ? coverage : null,
			note: note || null
		});
		busy = false;
		if (!res.ok) {
			error = res.message;
			return;
		}
		error = null;
		adding = false;
		target = null;
		note = '';
		await onchange();
	}

	async function remove(linkId: string, version: number) {
		if (!confirm('Remove this link? It stays in the history and can be restored by revert.')) return;
		const res = await api('POST', `/api/library/links/${linkId}/remove`, { baseVersion: version });
		error = res.ok ? null : res.message;
		await onchange();
	}
</script>

<div class="au-stack" data-testid="requirement-links">
	{#if error}<div class="au-alert au-alert--danger" role="alert">{error}</div>{/if}

	{#if groups.length === 0}
		<p class="au-muted">No links yet.</p>
	{/if}
	{#each groups as g (g.label)}
		<section class="au-stack" aria-label={g.label}>
			<h3 class="au-section__title">{g.label}</h3>
			<ul class="au-linklist">
				{#each g.links as l (l.id)}
					<li class="au-linkrow" data-testid="link-row">
						<button
							type="button"
							class="au-linkrow__open"
							onclick={() => onopen(`requirement:${l.other.id}`)}
						>
							<span class="au-ref">{l.other.refCode} · {l.other.sourceCode}</span>
							<span>{l.other.title}</span>
							{#if l.coverage}<span class="au-badge"
									>{l.coverage === 'full' ? 'Full coverage' : 'Partial coverage'}</span
								>{/if}
							{#if l.note}<span class="au-muted">{l.note}</span>{/if}
							{#if l.by}<span class="au-muted" data-testid="link-by">by {l.by}</span>{/if}
						</button>
						<button
							type="button"
							class="au-btn au-btn--small au-btn--danger"
							onclick={() => remove(l.id, l.version)}
						>
							Remove link
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if adding}
		<form class="au-stack au-item" onsubmit={add} aria-label="Add link">
			<div class="au-field">
				<label for="link-type">This requirement</label>
				<select id="link-type" bind:value={choice}>
					{#each CHOICES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
				</select>
			</div>
			{#if target}
				<div class="au-row au-between">
					<span><span class="au-ref">{target.refCode} · {target.sourceCode}</span> {target.title}</span>
					<button type="button" class="au-btn au-btn--ghost" onclick={() => (target = null)}>Change</button>
				</div>
			{:else}
				<RequirementPicker
					label="Find the other requirement"
					excludeId={extra.requirement.id}
					onpick={(r) => (target = r)}
				/>
			{/if}
			{#if chosen.type === 'implements'}
				<div class="au-field">
					<label for="link-coverage">Coverage</label>
					<select id="link-coverage" bind:value={coverage}>
						<option value="full">Full</option>
						<option value="partial">Partial</option>
					</select>
				</div>
			{/if}
			<div class="au-field">
				<label for="link-note">Note</label>
				<input id="link-note" bind:value={note} maxlength="500" />
			</div>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit" disabled={!target || busy}>Add link</button>
				<button class="au-btn au-btn--ghost" type="button" onclick={() => ((adding = false), (target = null))}
					>Cancel</button
				>
			</div>
		</form>
	{:else}
		<div><button class="au-btn" type="button" onclick={() => (adding = true)}>Add link</button></div>
	{/if}
</div>
