<script lang="ts">
	import AiAction from '#lib/components/ai/AiAction.svelte';
	import DestinationTabs from '#lib/components/DestinationTabs.svelte';
	import ProposalBar from '#lib/components/ai/ProposalBar.svelte';
	let { data, children } = $props();
</script>

<section class="au-screen">
	<DestinationTabs destination="findings" engagementId={data.engagement.id} />
	<AiAction
		action="propose_findings"
		label="Propose findings"
		hint="Proposes a finding with rationale for each unit that has none yet. Approval stays with you."
	/>
	<ProposalBar types={['finding']} />
	{@render children()}
</section>
