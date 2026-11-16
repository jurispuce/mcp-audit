<script lang="ts">
	import { enhance } from '$app/forms';
	import AiAction from '#lib/components/ai/AiAction.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';
	import type { SoaCheck } from '#lib/domain/soa.ts';

	/**
	 * The Statement of Applicability check (#81) for ISO/IEC 27001 and 27701 audits: upload the SoA,
	 * let AI read it, and decide each conflict with the audit scope (keep, with a reason, or remove).
	 */
	interface Props {
		check: SoaCheck;
	}
	let { check }: Props = $props();
	let uploading = $state(false);
	const KIND = { excluded: 'Excluded in the SoA', missing: 'Not listed in the SoA' } as const;
	const open = $derived(check.conflicts.filter((c) => !c.kept));
	const kept = $derived(check.conflicts.filter((c) => c.kept));
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			uploading = false;
			await update({ reset: false });
		};
</script>

{#if check.relevant}
	<section class="au-section au-item" aria-labelledby="soa-title" data-testid="soa-panel">
		<h2 class="au-section__title" id="soa-title">Statement of Applicability</h2>
		{#if !check.soa}
			<p class="au-muted">
				This audit covers ISO/IEC 27001 or 27701 controls. Upload the auditee's Statement of Applicability to
				check the audit scope against it: controls in scope that the SoA excludes are flagged for you to
				decide.
			</p>
			<form
				method="POST"
				action="?/uploadSoa"
				enctype="multipart/form-data"
				class="au-form"
				use:enhance={() => {
					uploading = true;
					return keep();
				}}
			>
				<div class="au-field">
					<label for="soa-file">Statement of Applicability</label>
					<input
						id="soa-file"
						name="file"
						type="file"
						required
						accept=".pdf,.xlsx,.xlsm,.csv,.docx,.md,.txt"
					/>
				</div>
				<div class="au-row">
					<button class="au-btn" type="submit" disabled={uploading}
						>{uploading ? 'Uploading…' : 'Upload SoA'}</button
					>
				</div>
			</form>
		{:else}
			<p class="au-muted" data-testid="soa-doc">
				{check.soa.name}{check.entries
					? `: ${check.entries} controls recorded.`
					: check.soa.textStatus === 'extracted'
						? ': not read yet.'
						: ': its text could not be read; upload it as PDF, Excel, Word, CSV or Markdown.'} A newer SoA is uploaded
				with Upload new version on Set-up, Documents.
			</p>
			{#if check.soa.textStatus === 'extracted'}
				<AiAction
					action="check_soa"
					label={check.entries ? 'Check scope against SoA again' : 'Check scope against SoA'}
					context={{ artifact_id: check.soa.id }}
					hint="Reads the SoA, records each control's applicability and justification, and flags conflicts with the audit scope. It does not change the scope."
				/>
			{/if}
			{#if check.entries}
				{#if open.length === 0}
					<p data-testid="soa-clear">
						{kept.length
							? 'Every conflict with the SoA is decided.'
							: 'The audit scope matches the SoA: no selected control is excluded or missing.'}
					</p>
				{:else}
					<p>
						<strong>{open.length} {open.length === 1 ? 'conflict' : 'conflicts'} to decide.</strong> Keep the control
						in the audit scope, with a reason, or remove it from the scope.
					</p>
				{/if}
				<ul class="au-list" aria-label="SoA conflicts">
					{#each [...open, ...kept] as c (c.requirementId)}
						<li>
							<ItemCard
								ref="{c.refCode} · {c.sourceCode}{c.locator ? ` · ${c.locator}` : ''}"
								title={c.title}
								badge={c.kept
									? { label: 'Kept in scope', tone: 'ok' }
									: { label: KIND[c.kind], tone: 'warn' }}
								body={c.kept
									? `Kept: ${c.kept.note}${c.justification ? ` · SoA: “${c.justification}”` : ''}`
									: c.justification
										? `SoA: “${c.justification}”`
										: c.kind === 'missing'
											? 'The SoA does not list this control.'
											: 'The SoA gives no justification.'}
								testid="soa-{c.refCode}"
							>
								{#snippet actions()}
									{#if !c.kept}
										<form method="POST" action="?/keepSoa" class="au-row au-wrap" use:enhance={keep}>
											<input type="hidden" name="requirement" value={c.requirementId} />
											<input
												name="note"
												aria-label="Why keep {c.refCode} in scope"
												placeholder="Why it stays in scope"
												required
											/>
											<button class="au-btn au-btn--small" type="submit">Keep in scope</button>
										</form>
									{/if}
									<form
										method="POST"
										action="?/removeSoa"
										use:enhance={({ cancel }) => {
											if (!confirm(`Remove ${c.refCode} from the audit scope?`)) return cancel();
											return keep();
										}}
									>
										<input type="hidden" name="requirement" value={c.requirementId} />
										<input
											type="hidden"
											name="reason"
											value={c.kind === 'excluded'
												? 'Excluded in the Statement of Applicability'
												: 'Not in the Statement of Applicability'}
										/>
										<button
											class="au-btn au-btn--small au-btn--ghost"
											type="submit"
											aria-label="Remove {c.refCode} from scope">Remove from scope</button
										>
									</form>
								{/snippet}
							</ItemCard>
						</li>
					{/each}
				</ul>
				{#if check.applicableNotInScope.length}
					<details data-testid="soa-not-in-scope">
						<summary
							>{check.applicableNotInScope.length}
							{check.applicableNotInScope.length === 1 ? 'control' : 'controls'} applicable in the SoA but not in
							the audit scope</summary
						>
						<p class="au-muted">
							{check.applicableNotInScope.map((x) => `${x.refCode} ${x.title}`).join(' · ')}
						</p>
					</details>
				{/if}
			{/if}
		{/if}
	</section>
{/if}
