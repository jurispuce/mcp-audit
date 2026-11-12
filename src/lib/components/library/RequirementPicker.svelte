<script lang="ts">
	import { api } from '#lib/api.ts';
	import type { Requirement } from './types';

	/** Search the library and choose one requirement. */
	interface Props {
		label: string;
		excludeId?: string;
		onpick: (r: Requirement) => void;
	}
	let { label, excludeId, onpick }: Props = $props();

	let query = $state('');
	let results = $state<(Requirement & { snippet: string })[]>([]);
	let searched = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const id = `pick-${Math.random().toString(36).slice(2, 8)}`;

	function search() {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			if (!query.trim()) {
				results = [];
				searched = false;
				return;
			}
			const qs = `q=${encodeURIComponent(query)}${excludeId ? `&exclude=${encodeURIComponent(excludeId)}` : ''}`;
			const res = await api<{ results: (Requirement & { snippet: string })[] }>(
				'GET',
				`/api/library/search?${qs}`
			);
			results = res.data?.results ?? [];
			searched = true;
		}, 200);
	}
</script>

<div class="au-stack">
	<div class="au-field">
		<label for={id}>{label}</label>
		<input
			{id}
			type="search"
			autocomplete="off"
			placeholder="Code, title or text"
			bind:value={query}
			oninput={search}
		/>
	</div>
	{#if results.length}
		<ul class="au-picker" aria-label="Search results">
			{#each results as r (r.id)}
				<li>
					<button type="button" class="au-picker__opt" onclick={() => onpick(r)}>
						<span class="au-ref">{r.refCode} · {r.sourceCode} · {r.language.toUpperCase()}</span>
						<span>{r.title}</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if searched}
		<p class="au-muted">No requirement matches.</p>
	{/if}
</div>
