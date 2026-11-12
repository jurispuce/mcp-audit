<script lang="ts">
	import AiAction from '#lib/components/ai/AiAction.svelte';
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import MappingRow from '#lib/components/library/MappingRow.svelte';

	let { data, form } = $props();
	const m = $derived(data.mapping);
	const prompt = $derived(
		data.from && data.to
			? `Use the mcp-audit tools to map "${data.from.title}" (source ${data.from.code}) to "${data.to.title}" (source ${data.to.code}). Read both with search_requirements and get_requirement. For each requirement of ${data.from.code}, propose links to ${data.to.code} with link_requirements: type implements (with coverage full or partial), details, explains or equivalent, and a one-line reason in note; start the reason with "Low confidence:" where it applies. Do not force a link where the texts only share a topic. Then tell me how many links wait on Library, Mapping.`
			: ''
	);
	let copied = $state(false);
</script>

<svelte:head><title>Mapping · Library · mcp-audit</title></svelte:head>

<FormMessage form={form as { message?: string; success?: string } | null} />

<form method="GET" class="au-row au-wrap au-item" aria-label="Choose what to map">
	<div class="au-field">
		<label for="map-from">Map this source</label>
		<select id="map-from" name="from" required>
			<option value="">Choose</option>
			{#each data.sources as s (s.id)}<option value={s.code} selected={data.from?.code === s.code}
					>{s.title}{s.status === 'proposed' ? ' (proposed)' : ''}</option
				>{/each}
		</select>
	</div>
	<div class="au-field">
		<label for="map-to">to this existing source</label>
		<select id="map-to" name="to" required>
			<option value="">Choose</option>
			{#each data.sources.filter((s) => s.code !== data.from?.code) as s (s.id)}<option
					value={s.code}
					selected={data.to?.code === s.code}>{s.title}{s.status === 'proposed' ? ' (proposed)' : ''}</option
				>{/each}
		</select>
	</div>
	<button class="au-btn au-btn--primary" type="submit" style="align-self: flex-end">Show mapping</button>
</form>

{#if !m}
	<div class="au-empty">
		<p>
			Choose the source to map and the existing source to map it to. Then ask Claude to propose links, or map
			by hand; every proposed link waits here for you to accept, edit or reject.
		</p>
	</div>
{:else}
	<section class="au-section" aria-labelledby="mapping-title">
		<div class="au-item">
			<div class="au-row au-between au-wrap">
				<h2 class="au-section__title" id="mapping-title" data-testid="mapping-summary">
					{m.mapped} of {m.rows.length} requirements mapped to {m.to.code}{m.proposed
						? `, ${m.proposed} proposed ${m.proposed === 1 ? 'link waits' : 'links wait'}`
						: ''}
				</h2>
				{#if m.proposed}
					<form
						method="POST"
						action="?from={encodeURIComponent(m.from.code)}&to={encodeURIComponent(m.to.code)}&/acceptAll"
						use:enhance={() =>
							async ({ update }) =>
								update({ reset: false })}
					>
						<input type="hidden" name="from" value={m.from.id} /><input
							type="hidden"
							name="to"
							value={m.to.id}
						/>
						<button class="au-btn au-btn--primary" type="submit">Accept all proposed links</button>
					</form>
				{/if}
			</div>
			<AiAction
				action="library_mapping"
				label="Propose mapping"
				context={{ from_source: m.from.code, to_source: m.to.code }}
				hint="Proposes links from {m.from.code} to {m.to
					.code} with a reason for each; you accept, edit or reject them below."
			/>
			<div class="au-meter" aria-hidden="true">
				<i style:width="{m.rows.length ? Math.round((m.mapped / m.rows.length) * 100) : 0}%"></i>
			</div>
			<a
				class="au-btn au-btn--small"
				href="?from={encodeURIComponent(m.from.code)}&to={encodeURIComponent(m.to.code)}{data.onlyOpen
					? ''
					: '&open=1'}">{data.onlyOpen ? 'Show all' : 'Show only open'}</a
			>
		</div>
		<details class="au-item">
			<summary>Ask Claude to propose this mapping</summary>
			<p class="au-muted">
				Copy this into Claude (Desktop or Code) connected to mcp-audit. Its links arrive here as proposals.
			</p>
			<textarea readonly rows="6" aria-label="Prompt for Claude" data-testid="mapping-prompt"
				>{prompt}</textarea
			>
			<button
				class="au-btn au-btn--small"
				type="button"
				onclick={async () => {
					await navigator.clipboard?.writeText(prompt).catch(() => {});
					copied = true;
				}}>{copied ? 'Copied' : 'Copy prompt'}</button
			>
		</details>
		<ul class="au-list" aria-label="Requirements of {m.from.title}">
			{#each m.rows as row (row.id)}
				<MappingRow {row} target={{ code: m.to.code, title: m.to.title }} />
			{/each}
		</ul>
	</section>
{/if}
