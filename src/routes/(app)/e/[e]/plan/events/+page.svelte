<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';
	import EventForm from '#lib/components/plan/EventForm.svelte';
	import EvidenceForm from '#lib/components/plan/EvidenceForm.svelte';
	import PlanHeader from '#lib/components/plan/PlanHeader.svelte';

	let { data, form } = $props();
	type Result = {
		message?: string;
		success?: string;
		fields?: Record<string, string>;
		values?: Record<string, string>;
	};
	const result = $derived((form ?? null) as Result | null);
	const e = $derived(data.engagement);
	const multiple = $derived(e.scopeMode === 'multiple');
	const editId = $derived(page.url.searchParams.get('edit'));
	const openId = $derived(page.url.searchParams.get('event'));
	const drafts = $derived(data.events.filter((x) => x.proposed));
	let adding = $state(false);
	let editingEvidence = $state<string | null>(null);
	const failed = (action: string, id?: string) =>
		result?.message &&
		result.values?.action === action &&
		(!id || result.values.id === id || result.values.event_id === id)
			? result
			: null;
	const after =
		() =>
		async ({
			update,
			result: r
		}: {
			update: (o?: { reset?: boolean }) => Promise<void>;
			result: { type: string };
		}) => {
			await update({ reset: false });
			if (r.type === 'success') {
				adding = false;
				editingEvidence = null;
			}
		};
	const STATUS_TONE: Record<string, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
		received: 'ok',
		partial: 'info',
		promised: 'warn',
		missing: 'danger',
		planned: 'neutral'
	};
	const statusLabel = $derived(new Map(data.statuses));
	const kindLabel = $derived(new Map(data.kinds));
	const when = (x: { date: string | null; startTime: string | null }) =>
		[x.date ?? 'No date', x.startTime].filter(Boolean).join(' ');
	const reqsOf = (ids: string[]) => data.requirements.filter((r) => ids.includes(r.id));
</script>

<svelte:head><title>Events · Plan · mcp-audit</title></svelte:head>

<PlanHeader plan={data.plan} engagement={e} />
<FormMessage form={result} />

{#if drafts.length}
	<div class="au-alert au-alert--info au-row au-between" data-testid="drafts-bar">
		<span
			>{drafts.length} drafted {drafts.length === 1 ? 'event waits' : 'events wait'} for review. They stay editable
			before you accept them.</span
		>
		<form method="POST" action="?/acceptAll" use:enhance={after}>
			<button class="au-btn au-btn--small au-btn--primary" type="submit">Accept all</button>
		</form>
	</div>
{/if}

<section class="au-section" aria-labelledby="events-title">
	<div class="au-row au-between">
		<h2 class="au-section__title" id="events-title">Events</h2>
		{#if !adding && !failed('add')}<button
				class="au-btn au-btn--primary"
				type="button"
				onclick={() => (adding = true)}>Add event</button
			>{/if}
	</div>

	{#if adding || failed('add')}
		<form method="POST" action="?/add" class="au-form au-item" use:enhance={after}>
			<h3 class="au-section__title">Add event</h3>
			<EventForm
				prefix="new"
				values={failed('add')?.values ?? {}}
				fields={failed('add')?.fields}
				people={data.people}
				requirements={data.requirements}
			/>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit">Add event</button>
				<button class="au-btn au-btn--ghost" type="button" onclick={() => (adding = false)}>Cancel</button>
			</div>
		</form>
	{/if}

	{#if data.events.length === 0 && !adding}
		<div class="au-empty">
			<p>
				No events yet. Add the first one, or ask Claude to draft a plan with the audit-plan-builder skill.
			</p>
		</div>
	{/if}

	<ul class="au-list" aria-label="Events">
		{#each data.events as ev (ev.id)}
			{@const evidence = data.evidence.filter((x) => x.eventId === ev.id)}
			<li id="event-{ev.id}">
				{#if editId === ev.id || failed('update', ev.id)}
					<form
						method="POST"
						action="?/update"
						class="au-form au-item"
						use:enhance={() =>
							async ({ update }) =>
								update({ reset: false })}
					>
						<h3 class="au-section__title">Edit event</h3>
						<input type="hidden" name="id" value={ev.id} />
						<input type="hidden" name="base_version" value={ev.version} />
						<EventForm
							prefix="edit-{ev.id}"
							values={failed('update', ev.id)?.values ?? {
								title: ev.title,
								format: ev.format,
								date: ev.date,
								start_time: ev.startTime,
								duration_min: ev.durationMin,
								participant_ids: ev.participantIds,
								participants_note: ev.participantsNote,
								location: ev.location,
								requirement_ids: ev.requirementIds,
								status: ev.status
							}}
							fields={failed('update', ev.id)?.fields}
							people={data.people}
							requirements={data.requirements}
							showStatus
						/>
						<div class="au-row">
							<button class="au-btn au-btn--primary" type="submit">Save event</button>
							<a class="au-btn au-btn--ghost" href="?#event-{ev.id}">Cancel</a>
						</div>
					</form>
				{:else}
					<ItemCard
						state={ev.proposed ? 'proposed' : 'default'}
						ref="{when(ev)} · {ev.formatLabel} · {ev.durationMin} min"
						title={ev.title}
						href="?item=event:{ev.id}"
						badge={ev.proposed
							? null
							: ev.status === 'held'
								? { label: 'Held', tone: 'ok' }
								: { label: 'Planned', tone: 'neutral' }}
						body="With {ev.participantsLine || 'nobody yet'}. Validates {ev.requirements
							.map((r) => r.refCode)
							.join(', ') || 'no requirements yet'}."
						version={ev.version}
						testid="event-{ev.title}"
					>
						{#snippet meta()}<span class="au-muted"
								>{ev.evidence.received} of {ev.evidence.total} evidence received</span
							>{/snippet}
						{#snippet actions()}
							{#if ev.proposed}
								<form method="POST" action="?/accept" use:enhance={after}>
									<input type="hidden" name="id" value={ev.id} /><button
										class="au-btn au-btn--small au-btn--primary"
										type="submit"
										aria-label="Accept {ev.title}">Accept</button
									>
								</form>
							{/if}
							<a class="au-btn au-btn--small" href="?edit={ev.id}#event-{ev.id}" aria-label="Edit {ev.title}"
								>Edit</a
							>
							<a
								class="au-btn au-btn--small"
								href={openId === ev.id ? '?' : `?event=${ev.id}#event-${ev.id}`}
								aria-expanded={openId === ev.id}
								aria-label="Plan evidence for {ev.title}">Plan evidence ({evidence.length})</a
							>
							<form method="POST" action={ev.proposed ? '?/reject' : '?/remove'} use:enhance={after}>
								<input type="hidden" name="id" value={ev.id} />
								<button
									class="au-btn au-btn--small au-btn--ghost"
									type="submit"
									aria-label="{ev.proposed ? 'Reject' : 'Remove'} {ev.title}"
									>{ev.proposed ? 'Reject' : 'Remove'}</button
								>
							</form>
						{/snippet}
					</ItemCard>
				{/if}

				{#if openId === ev.id}
					<section class="au-section au-evidence-panel" aria-label="Planned evidence for {ev.title}">
						{#if evidence.length === 0}<p class="au-muted">No evidence planned for this event yet.</p>{/if}
						<ul class="au-list" aria-label="Planned evidence">
							{#each evidence as x (x.id)}
								<li>
									{#if editingEvidence === x.id || failed('updateEvidence', x.id)}
										<form
											method="POST"
											action="?event={ev.id}&/updateEvidence"
											class="au-form au-item"
											use:enhance={after}
										>
											<input type="hidden" name="id" value={x.id} />
											<input type="hidden" name="base_version" value={x.version} />
											<EvidenceForm
												prefix="evd-{x.id}"
												values={failed('updateEvidence', x.id)?.values ?? {
													text: x.text,
													kind: x.kind,
													criticality: x.criticality,
													scope_id: x.scopeId,
													status: x.status,
													promised_by: x.promisedBy,
													promised_due: x.promisedDue,
													requirement_ids: x.requirementIds
												}}
												fields={failed('updateEvidence', x.id)?.fields}
												requirements={reqsOf(ev.requirementIds.concat(x.requirementIds))}
												scopes={data.scopes}
												{multiple}
												kinds={data.kinds}
												statuses={data.statuses}
											/>
											<div class="au-row">
												<button class="au-btn au-btn--primary au-btn--small" type="submit"
													>Save evidence</button
												>
												<button
													class="au-btn au-btn--ghost au-btn--small"
													type="button"
													onclick={() => (editingEvidence = null)}>Cancel</button
												>
											</div>
										</form>
									{:else}
										<ItemCard
											state={x.proposed ? 'proposed' : 'default'}
											ref="{kindLabel.get(x.kind)} · {x.requirementRefs.join(', ') ||
												'no requirement'}{multiple ? ` · ${x.scopeName}` : ''}"
											title={x.text}
											href="?item=evidence_item:{x.id}"
											badge={{ label: statusLabel.get(x.status) ?? x.status, tone: STATUS_TONE[x.status] }}
											body={x.status === 'promised' && (x.promisedBy || x.promisedDue)
												? `Promised by ${x.promisedBy ?? 'someone'}${x.promisedDue ? `, due ${x.promisedDue}` : ''}`
												: null}
											version={x.version}
											testid="evidence-{x.text}"
										>
											{#snippet meta()}<span class="au-crit au-crit--{x.criticality}"
													>{x.criticality.charAt(0).toUpperCase() + x.criticality.slice(1)} criticality</span
												>{/snippet}
											{#snippet actions()}
												<button
													class="au-btn au-btn--small"
													type="button"
													onclick={() => (editingEvidence = x.id)}
													aria-label="Edit evidence {x.text}">Edit</button
												>
												<form method="POST" action="?event={ev.id}&/removeEvidence" use:enhance={after}>
													<input type="hidden" name="id" value={x.id} />
													<button
														class="au-btn au-btn--small au-btn--ghost"
														type="submit"
														aria-label="Remove evidence {x.text}">Remove</button
													>
												</form>
											{/snippet}
										</ItemCard>
									{/if}
								</li>
							{/each}
						</ul>
						<form
							method="POST"
							action="?event={ev.id}&/addEvidence"
							class="au-form au-item"
							use:enhance={after}
						>
							<h3 class="au-section__title">Add planned evidence</h3>
							<input type="hidden" name="event_id" value={ev.id} />
							{#key data.evidence.length}
								<EvidenceForm
									prefix="new-evd-{ev.id}"
									values={failed('addEvidence', ev.id)?.values ?? {
										requirement_ids: ev.requirementIds.length === 1 ? ev.requirementIds : []
									}}
									fields={failed('addEvidence', ev.id)?.fields}
									requirements={reqsOf(ev.requirementIds)}
									scopes={data.scopes}
									{multiple}
									kinds={data.kinds}
								/>
							{/key}
							<div class="au-row">
								<button class="au-btn au-btn--primary" type="submit">Add evidence</button>
							</div>
						</form>
					</section>
				{/if}
			</li>
		{/each}
	</ul>
</section>
