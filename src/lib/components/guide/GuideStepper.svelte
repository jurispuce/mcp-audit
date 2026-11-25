<script lang="ts">
	import { STEPS, type GuideStep, type StepState } from '#lib/guide/content.ts';

	/** The five steps as a row to move along (#106). Every step can be opened from any other. */
	interface Props {
		current: GuideStep['key'] | null;
		states: Map<GuideStep['key'], StepState> | null;
		query: string;
	}
	let { current, states, query }: Props = $props();
	const LABEL = { done: 'done', current: 'next', todo: '' } as const;
</script>

<nav class="au-stepper" aria-label="Steps of an audit" data-testid="guide-stepper">
	<ol>
		{#each STEPS as s (s.key)}
			{@const state = states?.get(s.key)}
			<li>
				<a
					href="/guide/{s.key}{query}"
					aria-current={current === s.key ? 'step' : undefined}
					data-state={state ?? 'none'}
				>
					<span class="au-guide-num" class:au-guide-num--done={state === 'done'} aria-hidden="true"
						>{s.number}</span
					>
					<span class="au-stepper__name">{s.title}</span>
					{#if state && LABEL[state]}<span class="au-visually-hidden">, {LABEL[state]}</span>{/if}
				</a>
			</li>
		{/each}
	</ol>
</nav>
