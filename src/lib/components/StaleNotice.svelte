<script lang="ts">
	/**
	 * Shown when a save was refused because someone saved a newer version first.
	 * The form below shows the newer version; "Redo my change" puts the user's values back on top of it.
	 */
	interface Props {
		conflict: { version: number; current: Record<string, unknown>; attempted: Record<string, unknown> };
		labels: Record<string, string>;
		redoing: boolean;
		onredo: () => void;
		onkeep: () => void;
	}
	let { conflict, labels, redoing, onredo, onkeep }: Props = $props();

	const differences = $derived(
		Object.keys(labels)
			.filter((k) => String(conflict.attempted[k] ?? '') !== String(conflict.current[k] ?? ''))
			.map((k) => ({
				label: labels[k],
				theirs: String(conflict.current[k] ?? ''),
				yours: String(conflict.attempted[k] ?? '')
			}))
	);
</script>

<div class="au-alert au-alert--warn" role="alert" data-testid="stale-notice">
	<p class="au-alert__title">Someone else saved version {conflict.version} while you were editing</p>
	<p>
		Your change was not saved. {redoing
			? 'The form now holds your values on top of the newer version. Save to apply them.'
			: 'The form now shows the newer version.'}
	</p>
	{#if differences.length}
		<ul>
			{#each differences as d (d.label)}
				<li>
					{d.label}: <span class="au-diff-del">{d.theirs || '(empty)'}</span> → your value
					<span class="au-diff-ins">{d.yours || '(empty)'}</span>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="au-row">
		{#if redoing}
			<button type="button" class="au-btn au-btn--small" onclick={onkeep}>Show the newer version</button>
		{:else}
			<button type="button" class="au-btn au-btn--small" onclick={onredo}>Redo my change</button>
		{/if}
	</div>
</div>
