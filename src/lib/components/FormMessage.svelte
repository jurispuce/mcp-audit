<script lang="ts">
	interface Props {
		form: { message?: string; success?: string } | null | undefined;
	}
	let { form }: Props = $props();
</script>

{#if form?.message}
	<div class="au-alert au-alert--danger" role="alert">{form.message}</div>
{:else if form?.success}
	<div class="au-alert au-alert--ok" role="status">{form.success}</div>
{/if}
