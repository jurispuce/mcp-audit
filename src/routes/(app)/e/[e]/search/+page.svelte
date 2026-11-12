<script lang="ts">
	let { data } = $props();
	const groups = $derived([...new Set(data.results.map((r) => r.group))]);
	/** The snippet marks matches with [ and ]; show them highlighted without rendering HTML. */
	const parts = (s: string) =>
		s
			.split(/(\[[^\]]*\])/)
			.map((p) =>
				p.startsWith('[') && p.endsWith(']') ? { mark: true, text: p.slice(1, -1) } : { mark: false, text: p }
			);
</script>

<svelte:head><title>Search · mcp-audit</title></svelte:head>

<section class="au-screen">
	<header class="au-screen__head"><h1 class="au-screen__title">Search</h1></header>
	<form method="GET" class="au-row au-wrap" role="search">
		<div class="au-field au-grow">
			<label for="engagement-q">Search for</label>
			<input
				id="engagement-q"
				name="q"
				type="search"
				defaultValue={data.q}
				placeholder="Requirement code, words, event, document"
				autocomplete="off"
			/>
		</div>
		<button class="au-btn au-btn--primary" type="submit">Search</button>
	</form>
	{#if data.q && !data.results.length}
		<div class="au-empty"><p>Nothing in this engagement matches “{data.q}”.</p></div>
	{/if}
	{#each groups as g (g)}
		<section class="au-section" aria-label={g}>
			<h2 class="au-section__title">{g}</h2>
			<ul class="au-list" data-testid="search-results">
				{#each data.results.filter((r) => r.group === g) as r (`${r.type}:${r.id}`)}
					<li class="au-item">
						<span class="au-ref">{r.refLine}</span>
						<a
							class="au-titlelink"
							href="?q={encodeURIComponent(data.q)}&item={r.type}:{r.id}"
							data-sveltekit-reset="false"><strong>{r.label}</strong></a
						>
						<span class="au-snippet"
							>{#each parts(r.snippet) as p, i (i)}{#if p.mark}<mark>{p.text}</mark
									>{:else}{p.text}{/if}{/each}</span
						>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</section>
