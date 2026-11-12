<script lang="ts">
	import '@fontsource/ibm-plex-sans/400.css';
	import '@fontsource/ibm-plex-sans/600.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '../../design/tokens.css';
	import '../../design/components.css';

	import { onMount } from 'svelte';

	let { children } = $props();
	// Lets end-to-end tests wait until buttons with client-side behaviour respond.
	onMount(() => document.documentElement.setAttribute('data-hydrated', ''));
</script>

<div class="au">
	{@render children()}
</div>
