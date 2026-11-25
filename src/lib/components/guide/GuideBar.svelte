<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Rich from './Rich.svelte';
	import {
		STEPS,
		screenLabel,
		stepByKey,
		whereInStep,
		type GuideStep,
		type StepState
	} from '#lib/guide/content.ts';

	/**
	 * The guide bar (#106): on an engagement's screens after Go from a step of the guide. It keeps the
	 * step in view: what to do on this screen, the next action elsewhere, back to the guide, close.
	 */
	interface Props {
		engagementId: string;
		guide: { step: GuideStep['key']; state: StepState; facts: { done: boolean }[] };
	}
	let { engagementId, guide }: Props = $props();

	const s = $derived(stepByKey(guide.step)!);
	const base = $derived(`/e/${engagementId}`);
	const path = $derived(page.url.pathname.startsWith(base) ? page.url.pathname.slice(base.length) : '');
	const where = $derived(whereInStep(s, path === '/' ? '' : path));
	const nextStep = $derived(STEPS[s.number] ?? null);
	const doneFacts = $derived(guide.facts.filter((f) => f.done).length);
</script>

<aside class="au-guidebar" aria-label="Guide" data-testid="guide-bar" data-step={s.key}>
	<div class="au-guidebar__head">
		<span class="au-guide-num" class:au-guide-num--done={guide.state === 'done'} aria-hidden="true"
			>{s.number}</span
		>
		<span>
			<span class="au-guide-label">Guide · Step {s.number} of {STEPS.length}</span>
			<strong>{s.title}</strong>
			{#if guide.facts.length > 1}<span class="au-muted">
					· {doneFacts} of {guide.facts.length} done</span
				>{/if}
		</span>
	</div>
	<div class="au-guidebar__body" data-testid="guide-bar-hint">
		{#if guide.state === 'done'}
			<p data-testid="guide-bar-done">
				This step is done{nextStep ? `. Next: step ${nextStep.number}, ${nextStep.title}.` : '.'}
			</p>
		{/if}
		{#if where.here.length}
			<p><span class="au-guide-label">On this screen</span></p>
			<ul class="au-guide-list">
				{#each where.here as a (a.text)}<li><Rich text={a.text} /></li>{/each}
			</ul>
		{:else}
			<p>This step's work is on {s.screens.map((x) => x.label).join(', ')}.</p>
		{/if}
	</div>
	<div class="au-guidebar__actions">
		{#if where.next && where.next.screen !== undefined}
			<a
				class="au-btn au-btn--small {guide.state === 'done' ? '' : 'au-btn--primary'}"
				href="{base}{where.next.screen}"
				data-testid="guide-bar-next">Next: {screenLabel(s, where.next.screen)}</a
			>
		{/if}
		{#if guide.state === 'done' && nextStep}
			<a class="au-btn au-btn--small au-btn--primary" href="/guide/{nextStep.key}?e={engagementId}"
				>Step {nextStep.number}: {nextStep.title}</a
			>
		{/if}
		<a class="au-btn au-btn--small" href="/guide/{s.key}?e={engagementId}">Back to the guide</a>
		<form method="POST" action="/guide?/closeBar" use:enhance>
			<input type="hidden" name="back" value={page.url.pathname} />
			<button class="au-btn au-btn--small au-btn--ghost" type="submit" aria-label="Close the guide bar"
				>Close</button
			>
		</form>
	</div>
</aside>
