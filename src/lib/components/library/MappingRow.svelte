<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import RequirementPicker from './RequirementPicker.svelte';
	import type { Requirement } from './types';

	/** One requirement of the mapped source with its links to the target: accept, edit, reject, or add one by hand. */
	interface Link {
		id: string;
		version: number;
		type: string;
		label: string;
		coverage: string | null;
		note: string | null;
		status: 'proposed' | 'confirmed';
		by: string | null;
		target: { id: string; refCode: string; title: string };
		reverse: boolean;
	}
	interface Props {
		row: { id: string; refCode: string; title: string; status: string; links: Link[] };
		target: { code: string; title: string };
	}
	let { row, target }: Props = $props();
	let editing = $state<string | null>(null);
	let adding = $state(false);
	let picked = $state<Requirement | null>(null);
	let type = $state('implements');
	let editType = $state('implements');
	const TYPES = [
		['implements', 'Implements'],
		['details', 'Details'],
		['explains', 'Explains'],
		['equivalent', 'Equivalent to'],
		['conflicts', 'Conflicts with']
	];
	const after =
		() =>
		async ({
			update,
			result
		}: {
			update: (o?: { reset?: boolean }) => Promise<void>;
			result: { type: string };
		}) => {
			await update({ reset: false });
			if (result.type === 'success') {
				editing = null;
				adding = false;
				picked = null;
			}
		};
	const p = $derived(`m-${row.id.slice(0, 8)}`);
	/** Keep the chosen sources in the URL when a form action reloads the page. */
	const act = (name: string) => `${page.url.search ? `${page.url.search}&` : '?'}/${name}`;
	const mapped = $derived(row.links.some((l) => l.status === 'confirmed'));
</script>

<li class="au-item" class:au-item--gap={!row.links.length} data-testid="map-{row.refCode}">
	<div class="au-item__head">
		<div>
			<span class="au-ref">{row.refCode}{row.status === 'proposed' ? ' · proposed' : ''}</span>
			<h3 class="au-item__title">{row.title}</h3>
		</div>
		{#if mapped}<span class="au-badge au-badge--ok">Mapped</span>{:else if row.links.length}<span
				class="au-badge au-badge--ai">Proposed</span
			>{:else}<span class="au-badge">No link</span>{/if}
	</div>
	<ul class="au-list" aria-label="Links of {row.refCode}">
		{#each row.links as l (l.id)}
			<li class="au-stack au-maplink" data-testid="maplink" data-state={l.status}>
				<span>
					{#if l.status === 'proposed'}<span class="au-badge au-badge--ai">Proposed</span>{/if}
					<strong>{l.label}</strong> <span class="au-ref">{l.target.refCode}</span>
					{l.target.title}{l.coverage ? ` · ${l.coverage} coverage` : ''}
				</span>
				{#if l.note}<span class="au-muted">Reason: {l.note}</span>{/if}
				{#if l.by}<span class="au-muted">{l.by}</span>{/if}
				{#if editing === l.id}
					<form method="POST" action={act('edit')} class="au-row au-wrap" use:enhance={after}>
						<input type="hidden" name="id" value={l.id} />
						<input type="hidden" name="base_version" value={l.version} />
						<div class="au-field">
							<label for="{p}-t-{l.id}">Type</label><select
								id="{p}-t-{l.id}"
								name="type"
								bind:value={editType}
								>{#each TYPES as [v, lab] (v)}<option value={v}>{lab}</option>{/each}</select
							>
						</div>
						{#if editType === 'implements'}
							<div class="au-field">
								<label for="{p}-c-{l.id}">Coverage</label><select id="{p}-c-{l.id}" name="coverage"
									><option value="full" selected={l.coverage === 'full'}>Full</option><option
										value="partial"
										selected={l.coverage !== 'full'}>Partial</option
									></select
								>
							</div>
						{/if}
						<div class="au-field au-grow">
							<label for="{p}-n-{l.id}">Reason</label><input
								id="{p}-n-{l.id}"
								name="note"
								defaultValue={l.note ?? ''}
							/>
						</div>
						<button class="au-btn au-btn--primary au-btn--small" type="submit">Save link</button>
						<button class="au-btn au-btn--ghost au-btn--small" type="button" onclick={() => (editing = null)}
							>Cancel</button
						>
					</form>
				{:else}
					<span class="au-row au-wrap">
						{#if l.status === 'proposed'}
							<form method="POST" action={act('accept')} use:enhance={after}>
								<input type="hidden" name="id" value={l.id} /><button
									class="au-btn au-btn--small au-btn--primary"
									type="submit"
									aria-label="Accept link {row.refCode} to {l.target.refCode}">Accept</button
								>
							</form>
						{/if}
						<button
							class="au-btn au-btn--small"
							type="button"
							onclick={() => {
								editing = l.id;
								editType = l.type;
							}}
							aria-label="Edit link {row.refCode} to {l.target.refCode}">Edit</button
						>
						<form method="POST" action={act('reject')} use:enhance={after}>
							<input type="hidden" name="id" value={l.id} />
							<input type="hidden" name="proposed" value={l.status === 'proposed'} />
							<button
								class="au-btn au-btn--small au-btn--ghost"
								type="submit"
								aria-label="{l.status === 'proposed' ? 'Reject' : 'Remove'} link {row.refCode} to {l.target
									.refCode}">{l.status === 'proposed' ? 'Reject' : 'Remove'}</button
							>
						</form>
					</span>
				{/if}
			</li>
		{/each}
	</ul>
	{#if adding}
		<div class="au-stack">
			{#if !picked}
				<RequirementPicker label="Find in {target.title}" source={target.code} onpick={(r) => (picked = r)} />
			{:else}
				<form method="POST" action={act('add')} class="au-row au-wrap" use:enhance={after}>
					<input type="hidden" name="from" value={row.id} />
					<input type="hidden" name="to" value={picked.id} />
					<span><span class="au-ref">{picked.refCode}</span> {picked.title}</span>
					<div class="au-field">
						<label for="{p}-type">Type</label><select id="{p}-type" name="type" bind:value={type}
							>{#each TYPES as [v, lab] (v)}<option value={v}>{lab}</option>{/each}</select
						>
					</div>
					{#if type === 'implements'}
						<div class="au-field">
							<label for="{p}-cov">Coverage</label><select id="{p}-cov" name="coverage"
								><option value="partial">Partial</option><option value="full">Full</option></select
							>
						</div>
					{/if}
					<div class="au-field au-grow">
						<label for="{p}-note">Reason</label><input id="{p}-note" name="note" />
					</div>
					<button class="au-btn au-btn--primary au-btn--small" type="submit">Add link</button>
				</form>
			{/if}
			<button
				class="au-btn au-btn--ghost au-btn--small"
				type="button"
				onclick={() => {
					adding = false;
					picked = null;
				}}>Cancel</button
			>
		</div>
	{:else}
		<button
			class="au-btn au-btn--small"
			type="button"
			onclick={() => (adding = true)}
			aria-label="Map {row.refCode} by hand">Map by hand</button
		>
	{/if}
</li>
