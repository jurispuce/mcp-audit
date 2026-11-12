<script lang="ts">
	import { enhance } from '$app/forms';

	/** Link one artifact to planned evidence: which item, where in the artifact, an excerpt and how well it supports. */
	interface Props {
		artifactId: string;
		evidence: { id: string; text: string; eventTitle?: string }[];
		action?: string;
	}
	let { artifactId, evidence, action = '?/link' }: Props = $props();
	let open = $state(false);
	const p = $derived(`lnk-${artifactId.slice(0, 8)}`);
</script>

{#if !open}
	<button class="au-btn au-btn--small" type="button" onclick={() => (open = true)}>Link to evidence</button>
{:else}
	<form
		method="POST"
		{action}
		class="au-form au-grow"
		use:enhance={() =>
			async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') open = false;
			}}
	>
		<input type="hidden" name="artifact" value={artifactId} />
		<div class="au-field">
			<label for="{p}-ev">Planned evidence it shows</label>
			<select id="{p}-ev" name="evidence" required>
				<option value="">Choose</option>
				{#each evidence as x (x.id)}<option value={x.id}
						>{x.text}{x.eventTitle ? ` (${x.eventTitle})` : ''}</option
					>{/each}
			</select>
		</div>
		<div class="au-row au-wrap">
			<div class="au-field">
				<label for="{p}-loc">Where (page, row, time)</label>
				<input id="{p}-loc" name="locator" autocomplete="off" />
			</div>
			<div class="au-field">
				<label for="{p}-suf">Sufficiency</label>
				<select id="{p}-suf" name="sufficiency">
					<option value="supports">Supports</option>
					<option value="partial">Partly supports</option>
					<option value="contradicts">Contradicts</option>
				</select>
			</div>
		</div>
		<div class="au-field">
			<label for="{p}-ex">Excerpt (optional)</label>
			<input id="{p}-ex" name="excerpt" autocomplete="off" />
		</div>
		<div class="au-row">
			<button class="au-btn au-btn--primary au-btn--small" type="submit">Link</button>
			<button class="au-btn au-btn--ghost au-btn--small" type="button" onclick={() => (open = false)}
				>Cancel</button
			>
		</div>
	</form>
{/if}
