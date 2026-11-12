<script lang="ts">
	/** A prompt to paste into Claude, with a copy button. */
	let { label, prompt, testid }: { label: string; prompt: string; testid?: string } = $props();
	let copied = $state(false);
	const id = `prompt-${Math.random().toString(36).slice(2, 7)}`;
</script>

<div class="au-field">
	<label for={id}>{label}</label>
	<textarea {id} readonly rows="5" data-testid={testid}>{prompt}</textarea>
	<button
		class="au-btn au-btn--small"
		type="button"
		onclick={async () => {
			await navigator.clipboard?.writeText(prompt).catch(() => {});
			copied = true;
			setTimeout(() => (copied = false), 2000);
		}}>{copied ? 'Copied' : 'Copy prompt'}</button
	>
</div>
