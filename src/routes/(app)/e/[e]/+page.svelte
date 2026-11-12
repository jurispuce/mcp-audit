<script lang="ts">
	import EmptyScreen from '#lib/components/EmptyScreen.svelte';
	let { data } = $props();
</script>

<section class="au-screen">
	<header class="au-screen__head"><h1 class="au-screen__title">{data.engagement.name}</h1></header>
	<EmptyScreen title="Home" issue={36} />
</section>
