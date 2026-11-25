<script lang="ts">
	import { VIDEO, chapterOf, clock, type VideoChapter } from '#lib/guide/content.ts';

	/**
	 * The explainer video (#106), served by the instance itself, with captions. Given a chapter, it
	 * starts there and stops at the chapter's end; without one, it is the whole video with a list of
	 * its chapters to jump to. `chapterHref` turns a step's chapter into a link to that step's page.
	 */
	interface Props {
		chapter?: VideoChapter['key'];
		chapterHref?: (key: VideoChapter['key']) => string | null;
	}
	let { chapter, chapterHref }: Props = $props();

	let video: HTMLVideoElement | undefined = $state();
	const part = $derived(chapter ? chapterOf(chapter) : null);
	// A media fragment: the browser starts at the chapter and pauses at its end.
	const src = $derived(part ? `${VIDEO.src}#t=${part.start},${part.end}` : VIDEO.src);
	let current = $state<VideoChapter['key'] | null>(null);

	function play(c: VideoChapter) {
		if (!video) return;
		video.currentTime = c.start;
		void video.play().catch(() => {});
	}
	function onTime() {
		if (!video) return;
		const t = video.currentTime;
		current = VIDEO.chapters.find((c) => t >= c.start && t < c.end)?.key ?? null;
		// Within a step's page, the chapter ends where the step does.
		if (part && t >= part.end && t < part.end + 1 && !video.paused) video.pause();
	}
</script>

<div class="au-video" data-testid="explainer-video" data-chapter={chapter ?? 'all'}>
	<figure class="au-video__figure">
		<video
			bind:this={video}
			{src}
			poster={VIDEO.poster}
			controls
			preload="metadata"
			playsinline
			ontimeupdate={onTime}
			aria-label={part ? `${VIDEO.title}: ${part.title}` : VIDEO.title}
		>
			<track kind="captions" srclang="en" label="English" src={VIDEO.captions} default />
		</video>
		<figcaption class="au-muted">
			{#if part}
				{part.title}, {clock(part.end - part.start)} of the {clock(VIDEO.duration)} video.
			{:else}
				{VIDEO.title}, {clock(VIDEO.duration)}, with captions.
			{/if}
		</figcaption>
	</figure>
	{#if !part}
		<ol class="au-video__chapters" aria-label="Chapters">
			{#each VIDEO.chapters as c (c.key)}
				{@const href = chapterHref?.(c.key) ?? null}
				<li data-current={current === c.key}>
					<button class="au-linkbtn" type="button" onclick={() => play(c)}
						><span class="au-mono">{clock(c.start)}</span> {c.title}</button
					>
					{#if href}<a class="au-linkbtn" {href} aria-label="Open the step {c.title}">Open step</a>{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>
