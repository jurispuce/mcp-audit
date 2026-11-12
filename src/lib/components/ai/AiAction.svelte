<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '../Icon.svelte';

	/**
	 * An in-app AI button. Starts the action as a background job on the server, shows its progress, and
	 * can cancel it. What the action writes arrives as proposals, so the screen refreshes when it ends.
	 * Disabled with a reason when AI is switched off for the engagement or no checked model is set up.
	 */
	interface Props {
		action: string;
		label: string;
		/** Ids the action works on; the engagement is added from the page. */
		context?: Record<string, string | undefined>;
		/** One line under the button: what it will do. */
		hint?: string;
		/** Check the inputs before starting; return a message to stop. */
		validate?: () => string | null;
	}
	let { action, label, context = {}, hint, validate }: Props = $props();

	type Step = { at: string; kind: string; text: string; ok?: boolean };
	type Job = {
		id: string;
		status: 'running' | 'succeeded' | 'failed' | 'cancelled';
		steps: Step[];
		summary: string | null;
		error: string | null;
		model: string;
	};
	type Ai = {
		allowed: boolean;
		available: boolean;
		running: { id: string; action: string; context: Record<string, string> }[];
	};

	const ai = $derived(page.data.ai as Ai | undefined);
	const engagementId = $derived((page.data.engagement as { id: string } | undefined)?.id);
	const fullContext = $derived({
		...(engagementId ? { engagement_id: engagementId } : {}),
		...Object.fromEntries(Object.entries(context).filter(([, v]) => v))
	});
	const blocked = $derived(
		!ai || !ai.allowed
			? 'AI is switched off for this engagement. Switch it on in the engagement details on Home.'
			: !ai.available
				? 'In-app AI is not set up yet. An admin sets the gateway and models in Settings, AI.'
				: null
	);

	let job = $state<Job | null>(null);
	let message = $state<string | null>(null);
	let starting = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const running = $derived(job?.status === 'running');

	function sameContext(a: Record<string, string>) {
		return Object.entries(context).every(([k, v]) => !v || a[k] === v);
	}

	async function poll(id: string) {
		if (stopped) return;
		try {
			const res = await fetch(`/api/ai/jobs/${id}`);
			if (res.ok) {
				const body = (await res.json()) as { job: Job };
				const was = job?.status;
				job = body.job;
				if (job.status !== 'running') {
					if (was === 'running' || was === undefined) await invalidateAll();
					return;
				}
			}
		} catch {
			// a missed poll is retried
		}
		timer = setTimeout(() => poll(id), 1000);
	}

	onMount(() => {
		const existing = ai?.running.find((r) => r.action === action && sameContext(r.context));
		if (existing) {
			job = { id: existing.id, status: 'running', steps: [], summary: null, error: null, model: '' };
			poll(existing.id);
		}
	});
	onDestroy(() => {
		stopped = true;
		clearTimeout(timer);
	});

	async function start() {
		message = validate?.() ?? null;
		if (message) return;
		starting = true;
		try {
			const res = await fetch('/api/ai/jobs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action, context: fullContext })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				message = body.message ?? `Could not start (${res.status}).`;
				return;
			}
			job = body.job as Job;
			poll(job.id);
		} finally {
			starting = false;
		}
	}

	async function cancel() {
		if (!job) return;
		const res = await fetch(`/api/ai/jobs/${job.id}/cancel`, { method: 'POST' });
		if (!res.ok)
			message = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Could not cancel.';
	}

	const recent = $derived(job ? job.steps.slice(-5) : []);
	const STATUS: Record<Job['status'], string> = {
		running: 'Running',
		succeeded: 'Done',
		failed: 'Failed',
		cancelled: 'Cancelled'
	};
</script>

<div class="au-aiaction" data-testid="ai-{action}" data-status={job?.status ?? 'idle'}>
	<div class="au-row">
		<button
			class="au-btn au-btn--ai"
			type="button"
			disabled={!!blocked || running || starting}
			aria-describedby={blocked ? `ai-${action}-why` : hint ? `ai-${action}-hint` : undefined}
			onclick={start}
		>
			<Icon name="spark" />{running ? `${label}…` : label}
		</button>
		{#if running}
			<button class="au-btn au-btn--ghost au-btn--small" type="button" onclick={cancel}>Cancel</button>
		{/if}
	</div>
	{#if blocked}
		<p class="au-muted" id="ai-{action}-why">{blocked}</p>
	{:else if hint && !job}
		<p class="au-muted" id="ai-{action}-hint">{hint}</p>
	{/if}
	{#if message}<div class="au-alert au-alert--danger" role="alert">{message}</div>{/if}
	{#if job}
		<div class="au-aiaction__progress" aria-live="polite">
			<p>
				<strong>{STATUS[job.status]}</strong>{job.model ? ` · ${job.model}` : ''}
				{#if job.status === 'succeeded'}
					· What it proposed waits for your review.{/if}
			</p>
			{#if job.status === 'running' && recent.length}
				<ol class="au-aiaction__steps">
					{#each recent as s, i (i)}
						<li class:au-aiaction__fail={s.ok === false}>{s.text}</li>
					{/each}
				</ol>
			{/if}
			{#if job.error}<p class="au-field__error" role="alert">{job.error}</p>{/if}
			{#if job.summary && job.status !== 'running'}<p class="au-aiaction__summary">{job.summary}</p>{/if}
		</div>
	{/if}
</div>
