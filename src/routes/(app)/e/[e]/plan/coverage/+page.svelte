<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import PlanHeader from '#lib/components/plan/PlanHeader.svelte';

	let { data, form } = $props();
	const c = $derived(data.coverage);
	const onlyUncovered = $derived(page.url.searchParams.get('uncovered') === '1');
	let query = $state('');
	let picking = $state<string | null>(null);
	let eventQuery = $state('');
	const matches = (text: string, q: string) =>
		!q.trim() || text.toLowerCase().includes(q.trim().toLowerCase());
	const rows = $derived(
		c.rows.filter(
			(r) => (!onlyUncovered || r.events.length === 0) && matches(`${r.refCode} ${r.title}`, query)
		)
	);
	const uncovered = $derived(c.total - c.covered);
	const when = (x: { date: string | null; startTime: string | null }) =>
		[x.date ?? 'No date', x.startTime].filter(Boolean).join(' ');
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) =>
			update({ reset: false });
	// Changing the audit scope while planning (#82): requirements no event covers can leave the scope.
	let removing = $state<string[]>([]);
	let reason = $state('');
	let reasonInput = $state<HTMLInputElement | null>(null);
	const uncoveredIds = $derived(rows.filter((r) => r.events.length === 0).map((r) => r.requirementId));
	$effect.pre(() => {
		const still = removing.filter((id) => c.rows.some((r) => r.requirementId === id));
		if (still.length !== removing.length) removing = still;
	});
	const toggle = (id: string, on: boolean) =>
		(removing = on ? [...new Set([...removing, id])] : removing.filter((x) => x !== id));
</script>

<svelte:head><title>Coverage · Plan · {page.data.instance}</title></svelte:head>

<PlanHeader plan={data.plan} engagement={data.engagement} />
<FormMessage form={form as { message?: string; success?: string } | null} />

<section class="au-section" aria-labelledby="coverage-title">
	<div class="au-item">
		<div class="au-row au-between au-wrap">
			<h2 class="au-section__title" id="coverage-title" data-testid="coverage-summary">
				{c.covered} of {c.total} requirements are in an event
			</h2>
			<a
				class="au-btn au-btn--small"
				href={onlyUncovered ? '?' : '?uncovered=1'}
				aria-current={onlyUncovered ? 'true' : undefined}
			>
				Show only not covered{uncovered ? ` (${uncovered})` : ''}
			</a>
		</div>
		<div class="au-meter" aria-hidden="true">
			<i style:width="{c.total ? Math.round((c.covered / c.total) * 100) : 0}%"></i>
		</div>
	</div>
	<div class="au-field">
		<label for="cov-search">Search requirements</label>
		<input id="cov-search" type="search" placeholder="Code or words" autocomplete="off" bind:value={query} />
	</div>

	{#if c.total === 0}
		<div class="au-empty"><p>No requirements selected yet. Select them on Set-up, Requirements.</p></div>
	{:else if rows.length === 0}
		<div class="au-empty">
			<p>
				{onlyUncovered && !query ? 'Every requirement is in at least one event.' : 'No requirement matches.'}
			</p>
		</div>
	{/if}

	{#if uncoveredIds.length}
		<form
			id="remove-scope"
			method="POST"
			action="?/removeFromScope"
			class="au-selectbar"
			class:au-selectbar--active={removing.length > 0}
			aria-label="Change the audit scope"
			data-testid="scope-bar"
			use:enhance={({ cancel }) => {
				if (
					!confirm(
						`Remove ${removing.length} ${removing.length === 1 ? 'requirement' : 'requirements'} from the audit scope?`
					)
				)
					return cancel();
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') {
						removing = [];
						reason = '';
					}
				};
			}}
		>
			<span class="au-selectbar__count" aria-live="polite"
				>{removing.length
					? `${removing.length} selected to leave the audit scope`
					: 'Not every requirement needs auditing this time: select uncovered ones to remove them from the audit scope'}</span
			>
			{#if removing.length}
				<span class="au-row au-wrap">
					<input
						name="reason"
						bind:this={reasonInput}
						bind:value={reason}
						required
						aria-label="Why they leave the audit scope"
						placeholder="Why, for example: no site visit in this audit"
					/>
					<button class="au-btn au-btn--small au-btn--primary" type="submit">Remove from scope</button>
					<button class="au-btn au-btn--small au-btn--ghost" type="button" onclick={() => (removing = [])}
						>Clear selection</button
					>
				</span>
			{:else if uncoveredIds.length > 1}
				<button
					class="au-btn au-btn--small au-btn--ghost"
					type="button"
					onclick={() => (removing = [...uncoveredIds])}>Select all {uncoveredIds.length} not covered</button
				>
			{/if}
		</form>
	{/if}

	<ul class="au-list" aria-label="Requirements">
		{#each rows as r (r.requirementId)}
			{@const others = data.events.filter((e) => !e.requirementIds.includes(r.requirementId))}
			<li>
				<article
					class="au-item"
					class:au-item--gap={r.events.length === 0}
					data-testid="coverage-{r.refCode}"
				>
					<div class="au-item__head">
						<div>
							<span class="au-ref">{r.refCode} · {r.sourceCode}</span>
							<h3 class="au-item__title">{r.title}</h3>
						</div>
						{#if r.events.length}
							<span class="au-badge au-badge--ok"
								>{r.events.length} {r.events.length === 1 ? 'event' : 'events'}</span
							>
						{:else}
							<span class="au-badge au-badge--danger">Not covered</span>
						{/if}
					</div>
					<div class="au-row au-wrap">
						{#each r.events as ev (ev.id)}
							<span class="au-pill" class:au-pill--proposed={ev.proposed}>
								<a
									href="/e/{data.engagement.id}/plan/events?edit={ev.id}#event-{ev.id}"
									title="Open this event">{ev.title} <span class="au-muted">{when(ev)}</span></a
								>
								<form method="POST" action="?/include" use:enhance={keep}>
									<input type="hidden" name="event" value={ev.id} />
									<input type="hidden" name="requirement" value={r.requirementId} />
									<input type="hidden" name="included" value="false" />
									<button type="submit" aria-label="Remove {r.refCode} from {ev.title}">×</button>
								</form>
							</span>
						{/each}
						{#if r.events.length === 0}
							<label class="au-check-row au-select">
								<input
									type="checkbox"
									form="remove-scope"
									name="ids"
									value={r.requirementId}
									checked={removing.includes(r.requirementId)}
									onchange={(ev) => toggle(r.requirementId, ev.currentTarget.checked)}
									aria-label="Select {r.refCode} to remove from scope"
								/>
								Select
							</label>
							<button
								class="au-btn au-btn--small au-btn--ghost"
								type="button"
								onclick={() => {
									toggle(r.requirementId, true);
									queueMicrotask(() => reasonInput?.focus());
								}}
								aria-label="Remove {r.refCode} from scope">Remove from scope</button
							>
						{/if}
						<button
							class="au-btn au-btn--small"
							type="button"
							aria-expanded={picking === r.requirementId}
							onclick={() => {
								picking = picking === r.requirementId ? null : r.requirementId;
								eventQuery = '';
							}}
						>
							{picking === r.requirementId ? 'Close' : '+ Add to event'}
						</button>
					</div>
					{#if picking === r.requirementId}
						<div class="au-stack au-picker-box">
							<div class="au-field">
								<label for="pick-{r.requirementId}">Search events</label>
								<input
									id="pick-{r.requirementId}"
									type="search"
									autocomplete="off"
									placeholder="Title, participant or format"
									bind:value={eventQuery}
								/>
							</div>
							<ul class="au-picker" aria-label="Events to add {r.refCode} to">
								{#each others.filter( (e) => matches(`${e.title} ${e.participantsLine} ${e.formatLabel}`, eventQuery) ) as ev (ev.id)}
									<li>
										<form
											method="POST"
											action="?/include"
											use:enhance={() =>
												async ({ update }) => {
													picking = null;
													await update({ reset: false });
												}}
										>
											<input type="hidden" name="event" value={ev.id} />
											<input type="hidden" name="requirement" value={r.requirementId} />
											<input type="hidden" name="included" value="true" />
											<button class="au-picker__opt" type="submit">
												<strong>{ev.title}</strong>
												<span class="au-muted"
													>{when(ev)}, {ev.formatLabel}, {ev.participantsLine || 'no participants'}, {ev
														.requirementIds.length} requirements</span
												>
											</button>
										</form>
									</li>
								{/each}
								<li>
									<form method="POST" action="?/newEvent">
										<input type="hidden" name="requirement" value={r.requirementId} />
										<input type="hidden" name="ref" value={r.refCode} />
										<button class="au-picker__opt" type="submit"
											><strong>+ Create a new event</strong>
											<span class="au-muted">with {r.refCode} already in it</span></button
										>
									</form>
								</li>
							</ul>
						</div>
					{/if}
				</article>
			</li>
		{/each}
	</ul>
</section>
