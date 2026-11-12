<script lang="ts">
	import FormMessage from '#lib/components/FormMessage.svelte';
	import FindingList from '#lib/components/findings/FindingList.svelte';

	let { data, form } = $props();
	const multiple = $derived(data.engagement.scopeMode === 'multiple');
	const scopes = $derived([
		...new Map(data.cards.map((c) => [c.scopeId ?? 'all', c.scopeId ? c.scopeName : 'All scopes'])).entries()
	]);
	const requirements = $derived([...new Map(data.cards.map((c) => [c.requirementId, c])).values()]);
	const cell = (reqId: string, scopeKey: string) =>
		data.cards.find((c) => c.requirementId === reqId && (c.scopeId ?? 'all') === scopeKey);
	const TONE: Record<string, string> = {
		ok: 'au-badge--ok',
		info: 'au-badge--info',
		warn: 'au-badge--warn',
		danger: 'au-badge--danger',
		neutral: ''
	};
	const done = $derived(data.cards.filter((c) => c.finding?.status === 'approved').length);
</script>

<svelte:head><title>Findings · mcp-audit</title></svelte:head>

<FormMessage form={form as { message?: string; success?: string } | null} />
<p class="au-muted" data-testid="findings-summary">
	{done} of {data.cards.length} assessment units concluded.
</p>

{#if data.cards.length === 0}
	<div class="au-empty"><p>No assessment units yet. Select requirements on Set-up, Requirements.</p></div>
{:else}
	{#if multiple && scopes.length > 1}
		<div class="au-tablewrap au-matrix-wrap">
			<table class="au-table au-matrix" aria-label="Requirements by scope">
				<thead
					><tr
						><th>Requirement</th>{#each scopes as [key, name] (key)}<th>{name}</th>{/each}</tr
					></thead
				>
				<tbody>
					{#each requirements as r (r.requirementId)}
						<tr>
							<th scope="row">{r.refCode}</th>
							{#each scopes as [key] (key)}
								{@const c = cell(r.requirementId, key)}
								<td>
									{#if c}
										<a href="#unit-{c.unitId}">
											{#if c.finding?.value}<span class="au-badge {TONE[c.finding.value.tone] ?? ''}"
													>{c.finding.value.label}{c.finding.status !== 'approved'
														? ` (${c.finding.status})`
														: ''}</span
												>{:else}<span class="au-muted">Open</span>{/if}
										</a>
									{:else}<span class="au-muted">·</span>{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<FindingList
		cards={data.cards}
		scale={data.scale}
		multipleScopes={multiple}
		form={form as never}
		label="Assessment units"
	/>
{/if}
