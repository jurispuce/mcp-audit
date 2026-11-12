<script lang="ts">
	import '@fontsource/ibm-plex-sans/400.css';
	import '@fontsource/ibm-plex-sans/600.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '../../design/tokens.css';
	import '../../design/components.css';

	let { children } = $props();
</script>

<div class="au">
	{@render children()}
</div>
