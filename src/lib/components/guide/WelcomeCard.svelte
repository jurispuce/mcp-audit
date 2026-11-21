<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { GUIDE_INTRO, STEPS } from '#lib/guide/content.ts';

	/**
	 * The first-time welcome (#84): shown until the person opens the guide from it or hides it. The
	 * choice is stored on the user, so it holds on every device.
	 */
	const show = $derived(page.data.welcome === true);
	const engagementId = $derived((page.data.engagement as { id: string } | undefined)?.id ?? '');
</script>

{#if show}
	<aside class="au-welcome" aria-labelledby="welcome-title" data-testid="welcome">
		<h2 class="au-section__title" id="welcome-title">Welcome to mcp-audit</h2>
		<p>{GUIDE_INTRO}</p>
		<ol class="au-welcome__steps" aria-label="The five steps">
			{#each STEPS as s (s.key)}<li><span class="au-guide-num">{s.number}</span>{s.title}</li>{/each}
		</ol>
		<form method="POST" action="/guide?/welcome" class="au-row" use:enhance>
			<input type="hidden" name="e" value={engagementId} />
			<input type="hidden" name="back" value={page.url.pathname} />
			<button class="au-btn au-btn--primary" type="submit" name="to" value="guide">Open the guide</button>
			<button class="au-btn" type="submit" name="to" value="connect">Connect Claude or ChatGPT</button>
			<button class="au-btn au-btn--ghost" type="submit" name="to" value="stay">Hide this welcome</button>
		</form>
	</aside>
{/if}
