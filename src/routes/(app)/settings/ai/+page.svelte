<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';

	let { data, form } = $props();
	type Result = {
		action?: string;
		message?: string;
		success?: string;
		model?: string;
		available?: string[];
		fields?: Record<string, string>;
		values?: Record<string, string>;
	};
	const result = $derived((form ?? null) as Result | null);
	const resultAction = $derived(result?.action ?? result?.values?.action);
	const s = $derived(data.settings);
	const usable = $derived(s.models.filter((m) => m.check?.ok).map((m) => m.id));
	const keep = () => {
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
		};
	};
	let checking = $state<string | null>(null);
	const checkEnhance = (model: string) => () => {
		checking = model;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: resultAction === 'check' && !result?.message });
			checking = null;
		};
	};
	const from = (where: string) =>
		where === 'settings' ? 'saved here' : where === 'environment' ? 'from the environment' : 'not set';
</script>

<svelte:head><title>AI · Settings · mcp-audit</title></svelte:head>

<p class="au-muted">
	In-app AI reaches models through a LiteLLM gateway, so Claude, other providers and local models all work.
	Every AI action is an agent loop that calls tools, so a model must pass the tool-calling check before it can
	run one. What AI writes is stored as proposed for a person to accept.
</p>

<section class="au-section" aria-labelledby="gw-title">
	<h2 class="au-section__title" id="gw-title">Gateway</h2>
	{#if resultAction === 'gateway'}<FormMessage form={result} />{/if}
	<form method="POST" action="?/gateway" class="au-form" use:enhance={keep}>
		<Field
			label="Gateway address"
			name="base_url"
			type="url"
			placeholder="http://litellm:4000"
			value={resultAction === 'gateway' && result?.values ? result.values.base_url : s.baseUrl}
			error={resultAction === 'gateway' ? result?.fields?.base_url : undefined}
			hint="The LiteLLM proxy's address ({from(s.baseUrlFrom)}). LITELLM_BASE_URL sets a default."
		/>
		<Field
			label="Gateway key"
			name="api_key"
			type="password"
			autocomplete="off"
			placeholder={s.hasKey ? 'A key is set: leave empty to keep it' : 'sk-…'}
			hint="Write-only: it is never shown again ({from(s.keyFrom)}). LITELLM_API_KEY sets a default."
		/>
		{#if s.keyFrom === 'settings'}
			<label class="au-check-row"><input type="checkbox" name="clear_key" /> Remove the saved key</label>
		{/if}
		<div class="au-row"><button class="au-btn au-btn--primary" type="submit">Save gateway</button></div>
	</form>
</section>

<section class="au-section" aria-labelledby="models-title">
	<h2 class="au-section__title" id="models-title">Models</h2>
	{#if resultAction === 'check' || resultAction === 'remove' || resultAction === 'list'}
		<FormMessage form={result} />
	{/if}
	{#if !s.configured}
		<div class="au-empty"><p>Save the gateway address first.</p></div>
	{:else}
		<form method="POST" action="?/check" class="au-form" use:enhance={checkEnhance('new')}>
			<Field
				label="Model name"
				name="model"
				list="gateway-models"
				placeholder="claude-sonnet"
				required
				value={resultAction === 'check' && result?.message
					? (result.values?.model ?? result.model ?? '')
					: ''}
				error={resultAction === 'check' ? result?.fields?.model : undefined}
				hint="The name the gateway uses for the model. Adding it runs the tool-calling check."
			/>
			<datalist id="gateway-models">
				{#each result?.available ?? [] as m (m)}<option value={m}></option>{/each}
			</datalist>
			<div class="au-row">
				<button class="au-btn au-btn--primary" type="submit" disabled={checking !== null}
					>{checking === 'new' ? 'Checking…' : 'Add and check model'}</button
				>
				<button class="au-btn au-btn--ghost" type="submit" formaction="?/list" formnovalidate
					>Load models from gateway</button
				>
			</div>
		</form>
		{#if result?.available?.length}
			<p class="au-muted" data-testid="gateway-models">Offered: {result.available.join(', ')}</p>
		{/if}

		{#if s.models.length === 0}
			<div class="au-empty"><p>No models yet.</p></div>
		{:else}
			<ul class="au-list" aria-label="Models">
				{#each s.models as m (m.id)}
					<li class="au-item" data-testid="model-{m.id}" data-ok={m.check?.ok ? 'true' : 'false'}>
						<div class="au-item__head">
							<span class="au-item__title">{m.id}</span>
							{#if m.check?.ok}
								<span class="au-badge au-badge--ok">Tool calling works</span>
							{:else}
								<span class="au-badge au-badge--danger">Failed the check</span>
							{/if}
						</div>
						{#if m.check}
							<p class="au-muted">
								{m.check.message} Checked {new Date(m.check.at).toLocaleString()}.
							</p>
						{/if}
						<div class="au-item__actions au-row">
							<form method="POST" action="?/check" use:enhance={checkEnhance(m.id)}>
								<input type="hidden" name="model" value={m.id} />
								<button class="au-btn au-btn--ghost au-btn--small" type="submit" disabled={checking !== null}
									>{checking === m.id ? 'Checking…' : 'Check again'}</button
								>
							</form>
							<form
								method="POST"
								action="?/remove"
								use:enhance={({ cancel }) => {
									if (!confirm(`Remove ${m.id}? Actions using it lose their model.`)) cancel();
								}}
							>
								<input type="hidden" name="model" value={m.id} />
								<button class="au-btn au-btn--ghost au-btn--small" type="submit">Remove model</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<section class="au-section" aria-labelledby="assign-title">
	<h2 class="au-section__title" id="assign-title">Model per action</h2>
	{#if resultAction === 'assign'}<FormMessage form={result} />{/if}
	{#if usable.length === 0}
		<div class="au-empty">
			<p>Add a model that passes the tool-calling check to choose models per action.</p>
		</div>
	{:else}
		<p class="au-muted">
			An action without its own model uses the default. An engagement limited to one model (its Model setting
			on Home) always uses that model.
		</p>
		<form method="POST" action="?/assign" class="au-form" use:enhance={keep}>
			{#each [{ key: 'default', label: 'Default for all actions', skill: '' }, ...data.actions] as a (a.key)}
				{@const current = (s.assignments as Record<string, string | undefined>)[a.key] ?? ''}
				<div class="au-field" data-invalid={result?.fields?.[a.key] ? '' : undefined}>
					<label for="assign-{a.key}">{a.label}</label>
					<select id="assign-{a.key}" name={a.key}>
						<option value="" selected={!current}>{a.key === 'default' ? 'None' : 'Use the default'}</option>
						{#each usable as m (m)}<option value={m} selected={current === m}>{m}</option>{/each}
					</select>
					{#if result?.fields?.[a.key]}
						<span class="au-field__error">{result.fields[a.key]}</span>
					{:else if a.skill}
						<span class="au-muted">Runs the {a.skill} skill.</span>
					{/if}
				</div>
			{/each}
			<div class="au-row"><button class="au-btn au-btn--primary" type="submit">Save models</button></div>
		</form>
	{/if}
</section>
