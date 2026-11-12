<script lang="ts">
	import ItemCard from '../ItemCard.svelte';

	/** Events to run, each opening the event screen. */
	interface Props {
		events: {
			id: string;
			title: string;
			date: string | null;
			startTime: string | null;
			formatLabel: string;
			durationMin: number;
			participantsLine: string;
			status: string;
			evidence: { total: number; received: number };
		}[];
		base: string;
		label: string;
	}
	let { events, base, label }: Props = $props();
</script>

<ul class="au-list" aria-label={label}>
	{#each events as ev (ev.id)}
		<li>
			<ItemCard
				ref="{[ev.date ?? 'No date', ev.startTime]
					.filter(Boolean)
					.join(' ')} · {ev.formatLabel} · {ev.durationMin} min"
				title={ev.title}
				href="{base}/run/events/{ev.id}"
				badge={ev.status === 'held' ? { label: 'Held', tone: 'ok' } : { label: 'Planned', tone: 'neutral' }}
				body={ev.participantsLine ? `With ${ev.participantsLine}` : null}
				testid="run-event-{ev.title}"
			>
				{#snippet meta()}<span class="au-muted"
						>{ev.evidence.received} of {ev.evidence.total} evidence received</span
					>{/snippet}
				{#snippet actions()}<a class="au-btn au-btn--small au-btn--primary" href="{base}/run/events/{ev.id}"
						>Open event</a
					>{/snippet}
			</ItemCard>
		</li>
	{/each}
</ul>
