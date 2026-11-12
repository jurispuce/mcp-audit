<script lang="ts">
	import AiAction from '#lib/components/ai/AiAction.svelte';
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ArtifactLinker from '#lib/components/run/ArtifactLinker.svelte';
	import NoteComposer from '#lib/components/run/NoteComposer.svelte';

	let { data, form } = $props();
	type Result = {
		message?: string;
		success?: string;
		values?: Record<string, string>;
		exported?: { id: string; filename: string };
	};
	const result = $derived((form ?? null) as Result | null);
	const ev = $derived(data.event);
	const base = $derived(`/e/${data.engagement.id}`);
	const STATUS_TONE: Record<string, string> = {
		received: 'au-badge--ok',
		partial: 'au-badge--warn',
		promised: 'au-badge--warn',
		missing: 'au-badge--danger',
		planned: ''
	};
	const statusLabel = $derived(new Map(data.statuses));
	const proposed = $derived(data.links.filter((l) => l.status === 'proposed'));
	const first = $derived(data.notes.length ? Date.parse(data.notes[0]!.at) : 0);
	const offset = (at: string) => {
		const s = Math.max(0, Math.round((Date.parse(at) - first) / 1000));
		const h = Math.floor(s / 3600);
		const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
		const ss = String(s % 60).padStart(2, '0');
		return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
	};
	const linksOf = (id: string) => data.links.filter((l) => l.evidenceItemId === id);
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) =>
			update({ reset: false });
	let promising = $state<string | null>(null);
</script>

<svelte:head><title>{ev.title} · Run · mcp-audit</title></svelte:head>

<div class="au-event">
	<a class="au-btn au-btn--ghost au-btn--small" href="{base}/run/events">All events</a>
	<header class="au-stack">
		<div class="au-row au-between">
			<h2 class="au-screen__title" data-testid="event-title">{ev.title}</h2>
			<span class="au-badge {ev.status === 'held' ? 'au-badge--ok' : ''}" data-testid="event-status"
				>{ev.status === 'held' ? 'Held' : 'Planned'}</span
			>
		</div>
		<p class="au-muted">
			{[ev.date ?? 'No date', ev.startTime, ev.formatLabel, `${ev.durationMin} min`]
				.filter(Boolean)
				.join(' · ')}{ev.participantsLine ? `, with ${ev.participantsLine}` : ''}
		</p>
		<form method="POST" action="?/held" use:enhance={keep}>
			<input type="hidden" name="held" value={ev.status === 'held' ? 'false' : 'true'} />
			<button class="au-btn {ev.status === 'held' ? 'au-btn--ghost' : 'au-btn--primary'}" type="submit"
				>{ev.status === 'held' ? 'Mark as planned' : 'Mark held'}</button
			>
		</form>
	</header>

	<FormMessage form={result} />

	<AiAction
		action="process_event"
		label="Process event materials"
		context={{ event_id: ev.id }}
		hint="Reads this event's notes and documents and proposes evidence links, promises and issues."
	/>

	{#if proposed.length}
		<div class="au-proposal" data-testid="link-proposals">
			<span class="au-proposal__text"
				>{proposed.length} evidence {proposed.length === 1 ? 'link' : 'links'} proposed by AI</span
			>
			<form method="POST" action="?/acceptAllLinks" use:enhance={keep}>
				<input type="hidden" name="event" value={ev.id} />
				<button class="au-btn au-btn--small au-btn--primary" type="submit">Accept all</button>
			</form>
		</div>
	{/if}

	<section class="au-section" aria-labelledby="evidence-title">
		<h3 class="au-section__title" id="evidence-title">Planned evidence</h3>
		{#if data.evidence.length === 0}
			<div class="au-empty">
				<p>
					No evidence planned for this event. Plan it on <a href="{base}/plan/events?event={ev.id}"
						>Plan, Events</a
					>.
				</p>
			</div>
		{/if}
		<ul class="au-list au-evidence-rows" aria-label="Planned evidence">
			{#each data.evidence as x (x.id)}
				{@const links = linksOf(x.id)}
				<li class="au-evidence" data-testid="evidence-{x.text}" data-status={x.status}>
					<span
						class="au-check"
						class:au-check--on={x.status === 'received'}
						class:au-check--part={x.status === 'partial' || x.status === 'promised'}
						aria-hidden="true"
					>
						{#if x.status === 'received'}<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" /></svg
							>{:else if x.status === 'partial' || x.status === 'promised'}<svg viewBox="0 0 24 24"
								><path d="M6 12h12" /></svg
							>{/if}
					</span>
					<span class="au-evidence__text">
						<a class="au-titlelink" href="?item=evidence_item:{x.id}" data-sveltekit-reset="false">{x.text}</a
						>
						<span class="au-muted">
							{x.requirementRefs.join(', ') || 'No requirement'}{links.length
								? ` · linked: ${links.map((l) => `${l.artifactTitle}${l.status === 'proposed' ? ' (proposed)' : ''}`).join(', ')}`
								: ''}{x.status === 'promised'
								? ` · promised${x.promisedBy ? ` by ${x.promisedBy}` : ''}${x.promisedDue ? `, due ${x.promisedDue}` : ''}`
								: ''}
						</span>
						<span class="au-crit au-crit--{x.criticality}"
							>{x.criticality.charAt(0).toUpperCase() + x.criticality.slice(1)} criticality</span
						>
						{#if promising === x.id}
							<form
								method="POST"
								action="?/status"
								class="au-row au-wrap"
								use:enhance={() =>
									async ({ update, result: r }) => {
										await update({ reset: false });
										if (r.type === 'success') promising = null;
									}}
							>
								<input type="hidden" name="id" value={x.id} />
								<input type="hidden" name="base_version" value={x.version} />
								<input type="hidden" name="status" value="promised" />
								<span class="au-field"
									><label for="pby-{x.id}">Promised by</label><input
										id="pby-{x.id}"
										name="promised_by"
										defaultValue={x.promisedBy ?? ''}
									/></span
								>
								<span class="au-field"
									><label for="pdue-{x.id}">Due</label><input
										id="pdue-{x.id}"
										name="promised_due"
										type="date"
										defaultValue={x.promisedDue ?? ''}
									/></span
								>
								<button class="au-btn au-btn--small au-btn--primary" type="submit">Save promise</button>
							</form>
						{/if}
					</span>
					<span class="au-stack au-evidence__state">
						<span class="au-badge {STATUS_TONE[x.status]}">{statusLabel.get(x.status)}</span>
						<form method="POST" action="?/status" use:enhance={keep}>
							<input type="hidden" name="id" value={x.id} />
							<input type="hidden" name="base_version" value={x.version} />
							<input type="hidden" name="promised_by" value={x.promisedBy ?? ''} />
							<input type="hidden" name="promised_due" value={x.promisedDue ?? ''} />
							<label class="au-visually-hidden" for="st-{x.id}">Status of {x.text}</label>
							<select
								id="st-{x.id}"
								name="status"
								onchange={(e) => {
									if (e.currentTarget.value === 'promised') promising = x.id;
									e.currentTarget.form?.requestSubmit();
								}}
							>
								{#each data.statuses as [v, l] (v)}<option value={v} selected={x.status === v}>{l}</option
									>{/each}
							</select>
							<button class="au-visually-hidden" type="submit">Save status</button>
						</form>
					</span>
				</li>
			{/each}
		</ul>
	</section>

	<section class="au-section" aria-labelledby="notes-title">
		<h3 class="au-section__title" id="notes-title">Notes</h3>
		{#if data.notes.length}
			<ol class="au-list" aria-label="Notes">
				{#each data.notes as n (n.id)}
					<li class="au-note" data-testid="note">
						<span class="au-note__time">{offset(n.at)}</span>
						<span class="au-note__body">
							{#if n.type !== 'note'}<span
									class="au-badge {n.type === 'issue' ? 'au-badge--danger' : 'au-badge--warn'}"
									>{n.type === 'issue' ? 'Suspected issue' : 'Promise'}</span
								>{/if}
							<span>{n.text}</span>
							{#if n.mentions.length}<span class="au-muted">{n.mentions.map((m) => m.label).join(' · ')}</span
								>{/if}
						</span>
						<form method="POST" action="?/removeNote" use:enhance={keep}>
							<input type="hidden" name="id" value={n.id} />
							<button
								class="au-btn au-btn--small au-btn--ghost"
								type="submit"
								aria-label="Remove note {n.text}">Remove</button
							>
						</form>
					</li>
				{/each}
			</ol>
		{/if}
		<NoteComposer options={data.mentions} error={result?.values?.action === 'note' ? result.message : null} />
	</section>

	<section class="au-section" aria-labelledby="files-title">
		<h3 class="au-section__title" id="files-title">Files, photos and transcripts</h3>
		<form
			method="POST"
			action="?/capture"
			enctype="multipart/form-data"
			class="au-row au-wrap"
			use:enhance={() =>
				async ({ update }) =>
					update()}
		>
			<label class="au-btn">
				Add files
				<input
					class="au-visually-hidden"
					type="file"
					name="files"
					multiple
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				/>
			</label>
			<label class="au-btn">
				Take photo
				<input
					class="au-visually-hidden"
					type="file"
					name="files"
					accept="image/*"
					capture="environment"
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				/>
			</label>
			<button class="au-visually-hidden" type="submit">Upload</button>
		</form>
		<ul class="au-list" aria-label="Event artifacts">
			{#each data.artifacts as a (a.id)}
				{@const links = data.links.filter((l) => l.artifactId === a.id)}
				<li class="au-item" data-testid="artifact-{a.filename ?? a.title}">
					<div class="au-row au-between au-wrap">
						<a class="au-titlelink" href="?item=artifact:{a.id}" data-sveltekit-reset="false"
							><strong>{a.title}</strong></a
						>
						<span class="au-muted"
							>{a.state === 'mentioned' ? 'Mentioned, not received' : (a.kind ?? 'File')}</span
						>
					</div>
					{#each links as l (l.id)}
						<div class="au-row au-between au-wrap" data-testid="link">
							<span>
								<span
									class="au-badge {l.status === 'proposed'
										? 'au-badge--ai'
										: l.sufficiency === 'contradicts'
											? 'au-badge--danger'
											: l.sufficiency === 'partial'
												? 'au-badge--warn'
												: 'au-badge--ok'}"
									>{l.status === 'proposed' ? 'Proposed: ' : ''}{l.sufficiency === 'supports'
										? 'Supports'
										: l.sufficiency === 'partial'
											? 'Partly supports'
											: 'Contradicts'}</span
								>
								{l.evidenceText}{l.locator ? `, ${l.locator}` : ''}
							</span>
							<span class="au-row">
								{#if l.status === 'proposed'}
									<form method="POST" action="?/confirmLink" use:enhance={keep}>
										<input type="hidden" name="id" value={l.id} /><button
											class="au-btn au-btn--small au-btn--primary"
											type="submit"
											aria-label="Accept link to {l.evidenceText}">Accept</button
										>
									</form>
								{/if}
								<form method="POST" action="?/removeLink" use:enhance={keep}>
									<input type="hidden" name="id" value={l.id} />
									<input type="hidden" name="proposed" value={l.status === 'proposed'} />
									<button
										class="au-btn au-btn--small au-btn--ghost"
										type="submit"
										aria-label="{l.status === 'proposed' ? 'Reject' : 'Remove'} link to {l.evidenceText}"
										>{l.status === 'proposed' ? 'Reject' : 'Remove'}</button
									>
								</form>
							</span>
						</div>
					{/each}
					{#if a.state === 'received' && data.evidence.length}
						<ArtifactLinker
							artifactId={a.id}
							evidence={data.evidence.map((x) => ({ id: x.id, text: x.text }))}
						/>
					{/if}
				</li>
			{:else}
				<li class="au-muted">
					Nothing captured yet. Transcripts can also arrive through Claude (register_artifact).
				</li>
			{/each}
		</ul>
	</section>
	<section class="au-section" aria-labelledby="report-title">
		<h3 class="au-section__title" id="report-title">Post-event report</h3>
		<p class="au-muted">
			For the attendees: what was received, what is outstanding and what was agreed. No suspected issues,
			sufficiency or criticality.
		</p>
		<form method="POST" action="?/report" class="au-row au-wrap" use:enhance={keep}>
			<button class="au-btn" type="submit" name="format" value="docx">Export report as DOCX</button>
			<button class="au-btn" type="submit" name="format" value="pdf">Export report as PDF</button>
		</form>
		{#if result?.exported}<a
				class="au-btn au-btn--small"
				href="{base}/documents/{result.exported.id}/file"
				download
				data-testid="download-report">Download {result.exported.filename}</a
			>{/if}
		<details class="au-item">
			<summary>Preview</summary>
			<article class="au-doc" data-testid="report-preview">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html data.report.html}
			</article>
		</details>
	</section>
</div>
