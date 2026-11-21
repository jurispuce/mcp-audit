<script lang="ts">
	/** Text to copy (an address, a command, a configuration), with a Copy button. */
	interface Props {
		text: string;
		/** What is copied, for the button's accessible name: "MCP address". */
		label: string;
		testid?: string;
	}
	let { text, label, testid }: Props = $props();
	let copied = $state(false);
	let box = $state<HTMLElement | null>(null);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
		} catch {
			// No clipboard here (plain http, or an old browser): select the text so Ctrl+C works.
			if (box) {
				const range = document.createRange();
				range.selectNodeContents(box);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			}
			copied = false;
		}
		setTimeout(() => (copied = false), 2500);
	}
</script>

<div class="au-copybox" data-testid={testid}>
	<pre class="au-copybox__text" bind:this={box}>{text}</pre>
	<button class="au-btn au-btn--small" type="button" onclick={copy} aria-label="Copy {label}"
		>{copied ? 'Copied' : 'Copy'}</button
	>
</div>
