<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import Rich from '#lib/components/guide/Rich.svelte';
	import { GUIDE_INTRO, PREPARE, RULES, STEPS, stepProgress } from '#lib/guide/content.ts';

	let { data, form } = $props();
	const e = $derived(data.engagement);
	const progress = $derived(data.phases ? stepProgress(data.phases) : null);
	const doneCount = $derived(progress ? [...progress.values()].filter((p) => p.state === 'done').length : 0);
	const admin = $derived(data.user.role === 'admin');
	const STATE = { done: 'Done', current: 'Next', todo: '' } as const;
</script>

<svelte:head><title>Audit steps · Guide · {page.data.instance}</title></svelte:head>

<FormMessage form={(form ?? null) as { message?: string; success?: string } | null} />

<p class="au-guide-intro">{GUIDE_INTRO}</p>

<ul class="au-guide-rules" aria-label="Three rules">
	{#each RULES as r (r.title)}
		<li><strong>{r.title}</strong><span class="au-muted">{r.text}</span></li>
	{/each}
</ul>

{#if e}
	<p class="au-row au-between" data-testid="guide-progress">
		<span>{e.name}: {doneCount} of {STEPS.length} steps done</span>
		<a class="au-linkbtn" href="/guide">Show the guide without an engagement</a>
	</p>
{:else if data.engagements.length}
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
{:else}
	<p class="au-row au-muted">
		No engagement yet. Create one and the steps show its progress.
		<a class="au-linkbtn" href="/">Create the first engagement</a>
	</p>
{/if}

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
					<a
						class="au-linkbtn"
						href="{item.link.href}{item.link.href.startsWith('/guide') && e ? `?e=${e.id}` : ''}"
						>{item.link.label}</a
					>
				{/if}
			</li>
		{/each}
	</ul>
</details>

{#each STEPS as s (s.key)}
	{@const p = progress?.get(s.key)}
	<details
		class="au-item au-guide-step"
		data-testid="guide-step-{s.key}"
		data-state={p?.state ?? 'none'}
		open={p ? p.state === 'current' : s.number === 1}
	>
		<summary>
			<span class="au-guide-num" class:au-guide-num--done={p?.state === 'done'} aria-hidden="true"
				>{s.number}</span
			>
			<span class="au-guide-step__head"
				><strong>{s.title}</strong><span class="au-muted">{s.summary}</span></span
			>
			{#if p && STATE[p.state]}
				<span class="au-badge {p.state === 'done' ? 'au-badge--ok' : 'au-badge--info'}">{STATE[p.state]}</span
				>
			{/if}
		</summary>

		<div class="au-guide-cols">
			<section aria-label="What you do">
				<h3 class="au-guide-label">You do</h3>
				<ol class="au-guide-list">
					{#each s.you as line (line)}<li><Rich text={line} /></li>{/each}
				</ol>
			</section>
			<section aria-label="What AI can do">
				<h3 class="au-guide-label au-guide-label--ai">AI can</h3>
				<ul class="au-guide-list">
					{#each s.ai as line (line)}<li><Rich text={line} /></li>{/each}
				</ul>
			</section>
		</div>
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
		<div class="au-row">
			{#if e}
				{#each s.screens as screen (screen.path)}
					<a class="au-btn au-btn--small" href="/e/{e.id}{screen.path}">Open {screen.label}</a>
				{/each}
			{:else}
				<span class="au-muted">Screens: {s.screens.map((x) => x.label).join(' · ')}</span>
			{/if}
		</div>
	</details>
{/each}

{#if !data.welcome}
	<form method="POST" action="?/showWelcome" use:enhance>
		<button class="au-btn au-btn--ghost" type="submit">Show the welcome again</button>
	</form>
{/if}
