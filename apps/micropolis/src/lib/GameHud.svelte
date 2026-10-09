<script lang="ts">
	import { micropolisReactive } from '$lib/MicropolisReactive.svelte';
	import { toolState } from '$lib/ToolState.svelte';
	import { commandBus } from '$lib/CommandBus';

	const funds = $derived(micropolisReactive.totalFunds);
	const dateLabel = $derived(
		`${micropolisReactive.cityMonth}/${micropolisReactive.cityYear} · ${micropolisReactive.cityName || 'Micropolis'}`
	);
	const simLabel = $derived(
		micropolisReactive.simPaused
			? 'Paused'
			: micropolisReactive.simSpeed > 0
				? `Speed ${micropolisReactive.simSpeed + 1}`
				: 'Stopped'
	);
	const taxLabel = $derived(`Tax ${micropolisReactive.cityTax}%`);
	const humanPopulationLabel = $derived(`Residents ${micropolisReactive.cityPop.toLocaleString()}`);
	const aiPopulationLabel = $derived(`AI ${micropolisReactive.aiPop.toLocaleString()}`);
	const reservePercent = $derived(micropolisReactive.powerReserve * 100);
	const foodCoveragePercent = $derived(micropolisReactive.foodCoverage * 100);
	const priorityOptions = [
		{ value: 1, label: 'Menschen' },
		{ value: 0, label: 'Gleich' },
		{ value: 2, label: 'KI' },
	] as const;

	function setPowerPriority(priority: number): void {
		void commandBus.dispatch('power.set-priority', {
			source: 'button',
			simulator: micropolisReactive.attachedSimulator,
			syncPowerState: micropolisReactive.syncPowerFromEngine,
			args: { priority },
		});
	}

	function setFoodImport(enabled: boolean): void {
		void commandBus.dispatch('food.set-import', {
			source: 'button',
			simulator: micropolisReactive.attachedSimulator,
			syncFoodState: micropolisReactive.syncFoodFromEngine,
			args: { enabled },
		});
	}
</script>

<div class="game-hud" aria-live="polite">
	<div class="hud-row hud-row-primary">
		<span class="hud-funds">${funds.toLocaleString()}</span>
		<span class="hud-date" title={dateLabel}>{dateLabel}</span>
	</div>
	<div class="hud-row hud-meta">
		<span class="hud-rci">
			<span class="rci-item"><span class="rci-letter">R</span> {micropolisReactive.demandR}</span>
			<span class="rci-item"><span class="rci-letter">C</span> {micropolisReactive.demandC}</span>
			<span class="rci-item"><span class="rci-letter">I</span> {micropolisReactive.demandI}</span>
		</span>
		<span class="hud-tax">{taxLabel}</span>
		<span class="hud-speed" class:paused={micropolisReactive.simPaused}>{simLabel}</span>
	</div>
	<div class="hud-row hud-population">
		<span>{humanPopulationLabel}</span>
		<span class="hud-ai-population">{aiPopulationLabel}</span>
	</div>
	<div class="power-priority" role="group" aria-label="Power priority">
		{#each priorityOptions as option (option.value)}
			<button
				type="button"
				class:active={micropolisReactive.powerPriority === option.value}
				aria-pressed={micropolisReactive.powerPriority === option.value}
				onclick={() => setPowerPriority(option.value)}
			>{option.label}</button>
		{/each}
	</div>
	<div class="power-stats" aria-label="Power balance">
		<span>Reserve {reservePercent.toFixed(1)}%</span>
		<span>KI-Abdeckung {(micropolisReactive.aiCoverage * 100).toFixed(1)}%</span>
		<span>Unversorgt {micropolisReactive.unpoweredZoneCount}</span>
		<span>KI-Ertrag ${micropolisReactive.aiTaxFund.toLocaleString()}</span>
	</div>
	<div class="food-stats" aria-label="Food balance">
		<span>Nahrung {(foodCoveragePercent).toFixed(1)}%</span>
		<span>Importkosten ${micropolisReactive.foodImportCost.toLocaleString()}</span>
		<button
			type="button"
			class:active={micropolisReactive.foodImportEnabled}
			aria-pressed={micropolisReactive.foodImportEnabled}
			onclick={() => setFoodImport(!micropolisReactive.foodImportEnabled)}
		>Import {micropolisReactive.foodImportEnabled ? 'An' : 'Aus'}</button>
	</div>
	{#if toolState.lastToolFeedback}
		<div class="hud-feedback">{toolState.lastToolFeedback}</div>
	{/if}
</div>

<style>
	.game-hud {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		z-index: 20;
		pointer-events: none;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.85rem;
		line-height: 1.35;
		color: #f4f4f0;
		background: rgba(8, 12, 20, 0.82);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 6px;
		padding: 0.45rem 0.65rem;
		width: 22rem;
		box-sizing: border-box;
		backdrop-filter: blur(4px);
	}

	.hud-row {
		display: grid;
		gap: 0.5rem;
	}

	.hud-row-primary {
		grid-template-columns: 7.25rem 1fr;
		align-items: baseline;
	}

	.hud-meta {
		margin-top: 0.25rem;
		grid-template-columns: 1fr 4.25rem 4.5rem;
		align-items: baseline;
		font-size: 0.75rem;
		color: #dce4f8;
	}

	.hud-rci {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		font-variant-numeric: tabular-nums;
	}

	.hud-population {
		margin-top: 0.2rem;
		grid-template-columns: 1fr 1fr;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}

	.hud-ai-population {
		color: #ff8b8b;
		text-align: right;
	}

	.rci-item {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
	}

	.rci-letter {
		font-weight: 700;
		min-width: 0.65rem;
	}

	.hud-funds,
	.hud-date,
	.hud-tax,
	.hud-speed {
		font-variant-numeric: tabular-nums;
	}

	.hud-date {
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hud-tax,
	.hud-speed {
		text-align: right;
	}

	.hud-feedback {
		margin-top: 0.35rem;
		padding-top: 0.3rem;
		border-top: 1px solid rgba(255, 255, 255, 0.2);
		font-size: 0.78rem;
		font-weight: 600;
		color: #ffc840;
	}

	.power-priority {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.2rem;
		margin-top: 0.35rem;
		pointer-events: auto;
	}

	.power-priority button {
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 3px;
		padding: 0.18rem 0.25rem;
		background: rgba(255, 255, 255, 0.08);
		color: #dce4f8;
		font: inherit;
		font-size: 0.68rem;
		cursor: pointer;
	}

	.power-priority button.active {
		background: #284b70;
		border-color: #8ec8ff;
		color: #fff;
	}

	.power-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.1rem 0.45rem;
		margin-top: 0.25rem;
		font-size: 0.68rem;
		font-variant-numeric: tabular-nums;
		color: #c7d5eb;
	}

	.food-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.1rem 0.45rem;
		margin-top: 0.2rem;
		font-size: 0.68rem;
		font-variant-numeric: tabular-nums;
	}

	.food-stats button {
		grid-column: 1 / -1;
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 3px;
		padding: 0.18rem 0.25rem;
		background: rgba(255, 255, 255, 0.08);
		color: #dce4f8;
		font: inherit;
		cursor: pointer;
		pointer-events: auto;
	}

	.food-stats button.active {
		background: #315331;
		border-color: #a6e09e;
		color: #fff;
	}

	.hud-funds {
		font-weight: 700;
		color: #9cf59c;
	}

	.paused {
		color: #ffb347;
	}
</style>
