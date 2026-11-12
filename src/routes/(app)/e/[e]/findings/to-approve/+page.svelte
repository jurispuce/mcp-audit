<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import FindingList from '#lib/components/findings/FindingList.svelte';

	let { data, form } = $props();
	const proposed = $derived(data.cards.filter((c) => c.finding?.status === 'proposed').length);
	const drafts = $derived(data.cards.filter((c) => c.finding?.status === 'draft').length);
</script>

<svelte:head><title>To approve · Findings · mcp-audit</title></svelte:head>

<FormMessage form={form as { message?: string; success?: string } | null} />
{#if data.cards.length}
	<div class="au-row au-between au-wrap">
		<p class="au-muted">
			{drafts}
			{drafts === 1 ? 'draft' : 'drafts'} to approve{proposed
				? `, ${proposed} proposed by AI to review first`
				: ''}.
		</p>
		{#if drafts}
			<form
				method="POST"
				action="?/approveAll"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
			>
				<button class="au-btn au-btn--primary" type="submit">Approve all drafts</button>
			</form>
		{/if}
	</div>
	<FindingList
		cards={data.cards}
		scale={data.scale}
		multipleScopes={data.engagement.scopeMode === 'multiple'}
		form={form as never}
		label="Findings to approve"
	/>
{:else}
	<div class="au-empty"><p>Nothing waiting for approval.</p></div>
{/if}
