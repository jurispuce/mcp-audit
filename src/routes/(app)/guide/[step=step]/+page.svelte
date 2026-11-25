<script lang="ts">
	import { page } from '$app/state';
	import ExplainerVideo from '#lib/components/guide/ExplainerVideo.svelte';
	import GuideStepper from '#lib/components/guide/GuideStepper.svelte';
	import Rich from '#lib/components/guide/Rich.svelte';
	import { STEPS, screenLabel, stepByKey, stepProgress } from '#lib/guide/content.ts';

	let { data } = $props();
	const s = $derived(stepByKey(page.params.step)!);
	const e = $derived(data.engagement);
	const q = $derived(e ? `?e=${e.id}` : '');
	const progress = $derived(data.phases ? stepProgress(data.phases) : null);
	const states = $derived(progress ? new Map([...progress].map(([k, v]) => [k, v.state])) : null);
	const p = $derived(progress?.get(s.key) ?? null);
	const prev = $derived(STEPS[s.number - 2] ?? null);
	const next = $derived(STEPS[s.number] ?? null);
	const STATE = { done: 'Done', current: 'Next', todo: 'To do' } as const;
	/** Go: the screen in the engagement, with the guide bar on for this step. */
	const go = (screen: string) => `/e/${e!.id}${screen}?guide=${s.key}`;
</script>

<svelte:head><title>{s.number}. {s.title} · Guide · {page.data.instance}</title></svelte:head>

<GuideStepper current={s.key} {states} query={q} />

<article class="au-guide-page" data-testid="guide-step-{s.key}" data-state={p?.state ?? 'none'}>
	<header class="au-guide-page__head">
		<span class="au-guide-num" class:au-guide-num--done={p?.state === 'done'} aria-hidden="true"
			>{s.number}</span
		>
		<div>
			<p class="au-guide-label">Step {s.number} of {STEPS.length}</p>
			<h2 class="au-guide-page__title">{s.title}</h2>
			<p class="au-muted">{s.summary}</p>
		</div>
		{#if p}
			<span
				class="au-badge {p.state === 'done'
					? 'au-badge--ok'
					: p.state === 'current'
						? 'au-badge--info'
						: 'au-badge--neutral'}">{STATE[p.state]}</span
			>
		{/if}
	</header>

	{#if e}
		<div class="au-guide-engagement" data-testid="guide-engagement">
			<p class="au-muted">
				In <strong>{e.name}</strong>. Go opens the screen there, and a guide bar keeps this step with you.
			</p>
			<a class="au-linkbtn" href="/guide/{s.key}">Another engagement</a>
		</div>
	{:else}
		<nav class="au-guide-choose" aria-label="Engagement" data-testid="guide-choose">
			<span>Choose the engagement to work in, and each action gets a Go button to its screen:</span>
			{#if data.engagements.length}
				<span class="au-row">
					{#each data.engagements.slice(0, 8) as x (x.id)}
						<a class="au-btn au-btn--small" href="/guide/{s.key}?e={x.id}">{x.name}</a>
					{/each}
				</span>
			{:else}
				<a class="au-linkbtn" href="/">Create the first engagement</a>
			{/if}
		</nav>
	{/if}

	<div class="au-guide-page__body">
		<section aria-labelledby="you-do" class="au-guide-page__main">
			<h3 class="au-guide-label" id="you-do">You do</h3>
			<ol class="au-guide-actions">
				{#each s.you as a, i (a.text)}
					<li data-testid="guide-action">
						<span class="au-guide-actions__n" aria-hidden="true">{i + 1}</span>
						<span class="au-guide-actions__text" id="action-{i}"><Rich text={a.text} /></span>
						{#if a.screen !== undefined}
							{#if e}
								<a
									class="au-btn au-btn--small"
									href={go(a.screen)}
									data-sveltekit-preload-data="off"
									aria-describedby="action-{i}">Go: {screenLabel(s, a.screen)}</a
								>
							{:else}
								<span class="au-muted au-guide-actions__where">{screenLabel(s, a.screen)}</span>
							{/if}
						{/if}
					</li>
				{/each}
			</ol>

			<h3 class="au-guide-label au-guide-label--ai">AI can</h3>
			<ul class="au-guide-list">
				{#each s.ai as line (line)}<li><Rich text={line} /></li>{/each}
			</ul>
			<p><span class="au-guide-label">You decide</span> {s.decide}</p>
			<p><span class="au-guide-label">Done when</span> {s.done}</p>
			{#if s.tip}<p class="au-muted"><Rich text={s.tip} /></p>{/if}

			{#if p}
				<ul class="au-guide-facts" aria-label="Progress in {e?.name}">
					{#each p.facts as f (f.title)}
						<li data-done={f.done}>
							<span class="au-badge {f.done ? 'au-badge--ok' : 'au-badge--neutral'}"
								>{f.done ? 'Done' : 'Open'}</span
							>
							<span>{f.title}</span><span class="au-muted">{f.fact}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<aside class="au-guide-page__side" aria-label="Watch this step">
			<ExplainerVideo chapter={s.key} />
			<a class="au-linkbtn" href="/guide{q}">The whole video and all steps</a>
		</aside>
	</div>

	<nav class="au-row au-between au-guide-page__nav" aria-label="Previous and next step">
		{#if prev}
			<a class="au-btn" href="/guide/{prev.key}{q}" rel="prev">Previous: {prev.number}. {prev.title}</a>
		{:else}
			<a class="au-btn" href="/guide{q}">Overview</a>
		{/if}
		{#if next}
			<a class="au-btn au-btn--primary" href="/guide/{next.key}{q}" rel="next"
				>Next: {next.number}. {next.title}</a
			>
		{:else if e}
			<a class="au-btn au-btn--primary" href="/e/{e.id}/findings/conclusions">Open the conclusions</a>
		{/if}
	</nav>
</article>
