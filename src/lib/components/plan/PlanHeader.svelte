<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatWhen } from '#lib/format.ts';

	/** The plan as a whole: status, when it was set, and whether events changed since then. */
	interface Props {
		plan: { status: 'draft' | 'sent' | 'agreed'; at: string | null; changedSince: boolean; next: string[] };
		engagement: { id: string; version: number };
	}
	let { plan, engagement }: Props = $props();
	const BADGE = {
		draft: { label: 'Plan in draft', tone: '' },
		sent: { label: 'Plan sent to auditee', tone: 'au-badge--info' },
		agreed: { label: 'Plan agreed', tone: 'au-badge--ok' }
	} as const;
	const BUTTON: Record<string, Record<string, string>> = {
		draft: { sent: 'Mark plan as sent' },
		sent: { agreed: 'Mark plan agreed', draft: 'Back to draft' },
		agreed: { draft: 'Reopen plan' }
	};
	const b = $derived(BADGE[plan.status]);
</script>

<div class="au-item au-plan-head" data-testid="plan-header">
	<div class="au-row au-between">
		<span class="au-row">
			<span class="au-badge {b.tone}" data-testid="plan-status">{b.label}</span>
			{#if plan.changedSince}<span class="au-badge au-badge--warn" data-testid="plan-changed"
					>Changed since then</span
				>{/if}
			{#if plan.at && plan.status !== 'draft'}<span class="au-muted">{formatWhen(plan.at)}</span>{/if}
		</span>
		<span class="au-row">
			{#each plan.next as to, i (to)}
				<form
					method="POST"
					action="?/planStatus"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
				>
					<input type="hidden" name="base_version" value={engagement.version} />
					<input type="hidden" name="to" value={to} />
					<button
						class="au-btn au-btn--small {i === 0 && to !== 'draft' ? 'au-btn--primary' : 'au-btn--ghost'}"
						type="submit">{BUTTON[plan.status]?.[to]}</button
					>
				</form>
			{/each}
			<a
				class="au-btn au-btn--small au-btn--ghost"
				href="?item=engagement:{engagement.id}&tab=history"
				data-sveltekit-reset="false">History</a
			>
		</span>
	</div>
	<p class="au-muted">
		The plan goes to the auditee as a whole. Events, dates, participants, requirements and evidence stay
		editable in every state.
	</p>
</div>
