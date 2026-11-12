<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatWhen } from '#lib/format.ts';

	/**
	 * One assessment unit: requirement and scope, the evidence and what it showed, the auditee's own
	 * rules, suspected issues (auditor only), and the finding with its state and actions.
	 */
	interface ScaleValue {
		id: string;
		label: string;
		tone: string;
		isNonconformity: boolean;
	}
	interface Card {
		unitId: string;
		refCode: string;
		sourceCode: string;
		title: string;
		scopeName: string;
		criticality: string;
		evidence: {
			id: string;
			text: string;
			status: string;
			links: { sufficiency: string; status: string; artifactTitle: string; locator: string | null }[];
		}[];
		evidenceSummary: {
			total: number;
			received: number;
			partial: number;
			promised: number;
			missing: number;
			planned: number;
			contradicts: number;
		};
		internalRules: { id: string; refCode: string; title: string; coverage: string | null }[];
		suspectedIssues: { id: string; text: string }[];
		finding: null | {
			id: string;
			value: ScaleValue | null;
			rationale: string | null;
			evidenceItemIds: string[];
			confidence: string | null;
			status: 'proposed' | 'draft' | 'approved';
			approvedByName: string | null;
			approvedAt: string | null;
			approvedVersion: number | null;
			version: number;
		};
	}
	interface Props {
		card: Card;
		scale: ScaleValue[];
		multipleScopes: boolean;
		error?: { message?: string; fields?: Record<string, string>; values?: Record<string, string> } | null;
	}
	let { card, scale, multipleScopes, error = null }: Props = $props();
	const f = $derived(card.finding);
	const TONE: Record<string, string> = {
		ok: 'au-badge--ok',
		info: 'au-badge--info',
		warn: 'au-badge--warn',
		danger: 'au-badge--danger',
		neutral: ''
	};
	const STATUS: Record<string, string> = {
		received: 'received',
		partial: 'partly received',
		promised: 'promised',
		missing: 'missing',
		planned: 'planned'
	};
	const SUFF: Record<string, string> = {
		supports: 'supports',
		partial: 'partly supports',
		contradicts: 'contradicts'
	};
	const s = $derived(card.evidenceSummary);
	const summary = $derived(
		s.total
			? [
					`${s.received} of ${s.total} received`,
					s.partial && `${s.partial} partly`,
					s.promised && `${s.promised} promised`,
					s.missing && `${s.missing} missing`,
					s.contradicts && `${s.contradicts} contradicting`
				]
					.filter(Boolean)
					.join(', ')
			: 'No evidence planned'
	);
	const v = $derived(error?.values ?? null);
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) =>
			update({ reset: false });
	const id = $derived(`u-${card.unitId.slice(0, 8)}`);
</script>

<article
	class="au-item au-finding"
	class:au-item--proposed={f?.status === 'proposed'}
	class:au-item--locked={f?.status === 'approved'}
	id="unit-{card.unitId}"
	data-testid="unit-{card.refCode}{multipleScopes ? ` @ ${card.scopeName}` : ''}"
	data-state={f?.status ?? 'none'}
>
	<div class="au-item__head">
		<div>
			<span class="au-ref"
				>{card.refCode} · {card.sourceCode}{multipleScopes ? ` · ${card.scopeName}` : ''} ·
				<span class="au-crit au-crit--{card.criticality}">{card.criticality}</span></span
			>
			<h3 class="au-item__title">{card.title}</h3>
		</div>
		<span class="au-row">
			{#if f?.value}<span class="au-badge {TONE[f.value.tone] ?? ''}" data-testid="finding-value"
					>{f.value.label}</span
				>{/if}
			<span
				class="au-badge {f?.status === 'approved'
					? 'au-badge--ok'
					: f?.status === 'proposed'
						? 'au-badge--ai'
						: ''}"
				data-testid="finding-status"
				>{f
					? f.status === 'approved'
						? 'Conclusion'
						: f.status === 'proposed'
							? 'Proposed by AI'
							: 'Draft'
					: 'No finding'}</span
			>
		</span>
	</div>

	<details>
		<summary>Evidence: {summary}</summary>
		<ul class="au-evidence-list">
			{#each card.evidence as x (x.id)}
				<li>
					{x.text} <span class="au-muted">({STATUS[x.status]})</span>
					{#each x.links as l, i (i)}<br /><span class="au-muted"
							>{l.artifactTitle}{l.locator ? `, ${l.locator}` : ''}: {SUFF[l.sufficiency]}{l.status ===
							'proposed'
								? ' (proposed)'
								: ''}</span
						>{/each}
				</li>
			{/each}
		</ul>
	</details>
	{#if card.internalRules.length}
		<p class="au-muted">
			Internal rules: {card.internalRules
				.map((r) => `${r.refCode} ${r.title}${r.coverage ? ` (${r.coverage})` : ''}`)
				.join('; ')}
		</p>
	{/if}
	{#if card.suspectedIssues.length}
		<div class="au-alert au-alert--warn" data-testid="suspected-issues">
			<p class="au-alert__title">
				Suspected {card.suspectedIssues.length === 1 ? 'issue' : 'issues'} (auditor only)
			</p>
			<ul>
				{#each card.suspectedIssues as n (n.id)}<li>{n.text}</li>{/each}
			</ul>
		</div>
	{/if}

	{#if f?.status === 'approved'}
		<p>{f.rationale ?? ''}</p>
		<p class="au-muted">
			Approved by {f.approvedByName ?? 'someone'}{f.approvedAt ? `, ${formatWhen(f.approvedAt)}` : ''},
			version {f.approvedVersion}. Locked.
		</p>
		<div class="au-row">
			<form method="POST" action="?/reopen" use:enhance={keep}>
				<input type="hidden" name="id" value={f.id} /><button
					class="au-btn au-btn--small"
					type="submit"
					aria-label="Reopen {card.refCode}">Reopen</button
				>
			</form>
			<a
				class="au-btn au-btn--small au-btn--ghost"
				href="?item=finding:{f.id}&tab=history"
				data-sveltekit-reset="false">History</a
			>
		</div>
	{:else}
		{#if error?.message}<div class="au-alert au-alert--danger" role="alert">{error.message}</div>{/if}
		{#key `${f?.version ?? 0}`}
			<form method="POST" action="?/save" class="au-form" use:enhance={keep}>
				<input type="hidden" name="unit" value={card.unitId} />
				{#if f}<input type="hidden" name="base_version" value={f.version} />{/if}
				<div class="au-field">
					<label for="{id}-value">Finding</label>
					<select id="{id}-value" name="finding_value_id">
						<option value="">Not decided</option>
						{#each scale as sv (sv.id)}<option
								value={sv.id}
								selected={(v?.finding_value_id ?? f?.value?.id) === sv.id}>{sv.label}</option
							>{/each}
					</select>
				</div>
				<div class="au-field">
					<label for="{id}-why">Rationale</label>
					<textarea id="{id}-why" name="rationale" rows="3" defaultValue={v?.rationale ?? f?.rationale ?? ''}
					></textarea>
				</div>
				{#if card.evidence.length}
					<fieldset class="au-stack">
						<legend>Evidence relied on</legend>
						{#each card.evidence as x (x.id)}
							<label class="au-check-row"
								><input
									type="checkbox"
									name="evidence"
									value={x.id}
									checked={(v ? (v.evidence ?? '').split(',') : (f?.evidenceItemIds ?? [])).includes(x.id)}
								/>
								{x.text}</label
							>
						{/each}
					</fieldset>
				{/if}
				<div class="au-row au-wrap">
					<button class="au-btn" type="submit">Save draft</button>
					{#if f && f.status !== 'proposed'}<a
							class="au-btn au-btn--small au-btn--ghost"
							href="?item=finding:{f.id}&tab=comments"
							data-sveltekit-reset="false">Comments and history</a
						>{/if}
				</div>
			</form>
		{/key}
		{#if f?.status === 'proposed'}
			<div class="au-row">
				<form method="POST" action="?/accept" use:enhance={keep}>
					<input type="hidden" name="id" value={f.id} /><button
						class="au-btn au-btn--primary au-btn--small"
						type="submit"
						aria-label="Accept proposal for {card.refCode}">Accept as draft</button
					>
				</form>
				<form method="POST" action="?/reject" use:enhance={keep}>
					<input type="hidden" name="id" value={f.id} /><button
						class="au-btn au-btn--ghost au-btn--small"
						type="submit"
						aria-label="Reject proposal for {card.refCode}">Reject proposal</button
					>
				</form>
			</div>
		{:else if f?.status === 'draft'}
			<form method="POST" action="?/approve" use:enhance={keep}>
				<input type="hidden" name="id" value={f.id} />
				<input type="hidden" name="base_version" value={f.version} />
				<button
					class="au-btn au-btn--primary"
					type="submit"
					disabled={!f.value}
					aria-label="Approve {card.refCode}">Approve</button
				>
			</form>
		{/if}
	{/if}
</article>
