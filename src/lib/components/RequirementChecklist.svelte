<script lang="ts">
	/**
	 * Choose several requirements: a search box over a checklist. Ticked items stay visible while
	 * searching, so a choice never disappears from view.
	 */
	interface Item {
		id: string;
		refCode: string;
		title: string;
	}
	interface Props {
		items: Item[];
		name: string;
		label: string;
		selected?: string[];
		id: string;
	}
	let { items, name, label, selected = [], id }: Props = $props();
	// Starts from the saved choice; ticking changes it locally until the form is saved.
	let ticked = $derived([...selected]);
	let query = $state('');
	const visible = (item: Item) =>
		ticked.includes(item.id) ||
		!query.trim() ||
		`${item.refCode} ${item.title}`.toLowerCase().includes(query.trim().toLowerCase());
	const shown = $derived(items.filter(visible));
</script>

<fieldset class="au-stack" data-testid="requirement-checklist">
	<legend>{label} <span class="au-muted">({ticked.length} ticked)</span></legend>
	<div class="au-field">
		<label for="{id}-search">Search requirements</label>
		<input id="{id}-search" type="search" autocomplete="off" placeholder="Code or title" bind:value={query} />
	</div>
	<ul class="au-list au-checklist">
		{#each items as item (item.id)}
			<li hidden={!shown.includes(item)}>
				<label class="au-check-row">
					<input type="checkbox" {name} value={item.id} bind:group={ticked} />
					<span><span class="au-ref">{item.refCode}</span> {item.title}</span>
				</label>
			</li>
		{/each}
	</ul>
	{#if !shown.length}<p class="au-muted">No selected requirement matches.</p>{/if}
</fieldset>
