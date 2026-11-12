<script lang="ts">
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ArtifactLinker from '#lib/components/run/ArtifactLinker.svelte';
	let { data, form } = $props();
	const base = $derived(`/e/${data.engagement.id}`);
	const ORIGIN: Record<string, string> = {
		upload: 'Uploaded',
		mcp: 'From Claude',
		mention: 'Mentioned',
		generated: 'Generated'
	};
</script>

<svelte:head><title>Inbox · Run · mcp-audit</title></svelte:head>

<FormMessage form={form as { message?: string; success?: string } | null} />
<p class="au-muted">Files, transcripts and documents not yet linked to planned evidence.</p>
{#if data.items.length}
	<ul class="au-list" aria-label="Inbox">
		{#each data.items as a (a.id)}
			<li class="au-item" data-testid="inbox-{a.filename ?? a.title}">
				<div class="au-row au-between au-wrap">
					<a href="?item=artifact:{a.id}" data-sveltekit-reset="false"><strong>{a.title}</strong></a>
					<span class="au-muted"
						>{ORIGIN[a.origin] ?? a.origin}{a.eventTitle ? ` · ${a.eventTitle}` : ''}</span
					>
				</div>
				<div class="au-row au-wrap">
					{#if data.evidence.length}<ArtifactLinker artifactId={a.id} evidence={data.evidence} />{/if}
					{#if a.eventId}<a class="au-btn au-btn--small au-btn--ghost" href="{base}/run/events/{a.eventId}"
							>Open event</a
						>{/if}
				</div>
			</li>
		{/each}
	</ul>
{:else}
	<div class="au-empty"><p>Nothing waiting. Everything received is linked to planned evidence.</p></div>
{/if}
