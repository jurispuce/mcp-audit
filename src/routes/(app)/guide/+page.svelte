<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ExplainerVideo from '#lib/components/guide/ExplainerVideo.svelte';
	import { GUIDE_INTRO, PREPARE, RULES, STEPS, stepByKey, stepProgress } from '#lib/guide/content.ts';

	let { data, form } = $props();
	const e = $derived(data.engagement);
	const q = $derived(e ? `?e=${e.id}` : '');
	const progress = $derived(data.phases ? stepProgress(data.phases) : null);
	const doneCount = $derived(progress ? [...progress.values()].filter((p) => p.state === 'done').length : 0);
	const next = $derived(
		progress ? (STEPS.find((s) => progress.get(s.key)!.state === 'current') ?? null) : null
	);
	const admin = $derived(data.user.role === 'admin');
	const STATE = { done: 'Done', current: 'Next', todo: '' } as const;
</script>

<svelte:head><title>Audit steps · Guide · {page.data.instance}</title></svelte:head>

<FormMessage form={(form ?? null) as { message?: string; success?: string } | null} />

<div class="au-guide-top">
	<div class="au-guide-top__text">
		<p class="au-guide-intro">{GUIDE_INTRO}</p>
		{#if e}
			<p data-testid="guide-progress">
				<strong>{e.name}</strong>: {doneCount} of {STEPS.length} steps done.
				<a class="au-linkbtn" href="/guide">Show the guide without an engagement</a>
			</p>
			{#if next}
				<a class="au-btn au-btn--primary" href="/guide/{next.key}{q}" data-testid="guide-continue"
					>Continue with step {next.number}: {next.title}</a
				>
			{/if}
		{:else}
			<a class="au-btn au-btn--primary" href="/guide/setup" data-testid="guide-start"
				>Start with step 1: Set up</a
			>
		{/if}
	</div>
	<ExplainerVideo chapterHref={(key) => (stepByKey(key) ? `/guide/${key}${q}` : null)} />
</div>

<ol class="au-guide-tiles" aria-label="The five steps">
	{#each STEPS as s (s.key)}
		{@const p = progress?.get(s.key)}
		<li>
			<a
				class="au-guide-tile"
				href="/guide/{s.key}{q}"
				data-testid="guide-tile-{s.key}"
				data-state={p?.state ?? 'none'}
			>
				<span class="au-row au-between">
					<span class="au-guide-num" class:au-guide-num--done={p?.state === 'done'} aria-hidden="true"
						>{s.number}</span
					>
					{#if p && STATE[p.state]}
						<span class="au-badge {p.state === 'done' ? 'au-badge--ok' : 'au-badge--info'}"
							>{STATE[p.state]}</span
						>
					{/if}
				</span>
				<strong>{s.title}</strong>
				<span class="au-muted">{s.summary}</span>
				<span class="au-guide-tile__go">Open step {s.number}</span>
			</a>
		</li>
	{/each}
</ol>

{#if !e && data.engagements.length}
	<nav class="au-guide-choose" aria-label="Engagement">
		<span class="au-muted"
			>Show the steps for an engagement, with its progress and buttons to its screens:</span
		>
		<span class="au-row">
			{#each data.engagements.slice(0, 8) as x (x.id)}
				<a class="au-btn au-btn--small" href="/guide?e={x.id}">{x.name}</a>
			{/each}
		</span>
	</nav>
{:else if !e}
	<p class="au-row au-muted">
		No engagement yet. Create one and the steps show its progress.
		<a class="au-linkbtn" href="/">Create the first engagement</a>
	</p>
{/if}

<section aria-labelledby="rules-title">
	<h2 class="au-section__title" id="rules-title">Three rules</h2>
	<ul class="au-guide-rules" aria-labelledby="rules-title">
		{#each RULES as r (r.title)}
			<li><strong>{r.title}</strong><span class="au-muted">{r.text}</span></li>
		{/each}
	</ul>
</section>

<details class="au-item au-guide-step" data-testid="guide-prepare">
	<summary>
		<span class="au-guide-num au-guide-num--plain" aria-hidden="true">0</span>
		<span class="au-guide-step__head"
			><strong>{PREPARE.title}</strong><span class="au-muted">{PREPARE.summary}</span></span
		>
	</summary>
	<ul class="au-guide-list">
		{#each PREPARE.items as item (item.text)}
			<li>
				{item.text}
				{#if item.admin}<span class="au-badge au-badge--neutral">Admin</span>{/if}
				{#if item.link && (!item.admin || admin)}
					<a class="au-linkbtn" href="{item.link.href}{item.link.href.startsWith('/guide') ? q : ''}"
						>{item.link.label}</a
					>
				{/if}
			</li>
		{/each}
	</ul>
</details>

{#if !data.welcome}
	<form method="POST" action="?/showWelcome" use:enhance>
		<button class="au-btn au-btn--ghost" type="submit">Show the welcome again</button>
	</form>
{/if}
