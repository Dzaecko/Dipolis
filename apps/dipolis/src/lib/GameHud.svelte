<script lang="ts">
	import { micropolisReactive } from '$lib/MicropolisReactive.svelte';
	import { toolState } from '$lib/ToolState.svelte';

	const displayedCityName = $derived(
		micropolisReactive.cityName && micropolisReactive.cityName.toLowerCase() !== 'micropolis'
			? micropolisReactive.cityName
			: 'Dipolis',
	);
	const dateLabel = $derived(
		`${micropolisReactive.cityMonth}/${micropolisReactive.cityYear} · ${displayedCityName}`
	);
	const unrestLabel = $derived(
		`${micropolisReactive.unrest.toFixed(1)} · Stufe ${micropolisReactive.unrestStage}`
	);
</script>

<section class="city-hud" aria-label="Stadtstatus" aria-live="polite">
	<header class="hud-header">
		<div class="city-funds">
			<span class="stat-label">Stadtkasse</span>
			<strong>${micropolisReactive.totalFunds.toLocaleString()}</strong>
		</div>
		<div class="date-status">
			<span>{dateLabel}</span>
			<span class:paused={micropolisReactive.simPaused}>
				{micropolisReactive.simPaused
					? 'Pausiert'
					: micropolisReactive.simSpeed > 0
						? `Tempo ${micropolisReactive.simSpeed + 1}`
						: 'Gestoppt'}
			</span>
		</div>
	</header>

	<div class="faction-cash">
		<div class="faction-stat human-stat">
			<span class="faction-name">
				<span class="person-symbol" aria-hidden="true">●</span>
				Menschen
			</span>
			<strong>${micropolisReactive.humanTaxFund.toLocaleString()}</strong>
			<span class="faction-caption">Steueraufkommen</span>
		</div>
		<div class="faction-stat ai-stat">
			<span class="faction-name"><span class="ai-diamond" aria-hidden="true">◆</span> KI</span>
			<strong>${micropolisReactive.aiTaxFund.toLocaleString()}</strong>
			<span class="faction-caption">Steueraufkommen</span>
		</div>
	</div>

	<div class="status-grid">
		<div class="metric power-metric">
			<span class="stat-label">Strom Kapazität / Bedarf</span>
			<strong>{micropolisReactive.powerCapacity.toLocaleString()} / {micropolisReactive.powerDemand.toLocaleString()}</strong>
		</div>
		<div class="metric">
			<span class="stat-label">Reserve</span>
			<strong>{(micropolisReactive.powerReserve * 100).toFixed(1)}%</strong>
		</div>
		<div class="metric">
			<span class="stat-label">Nahrung</span>
			<strong>{(micropolisReactive.foodCoverage * 100).toFixed(1)}%</strong>
		</div>
		<div class="metric">
			<span class="stat-label">Arbeitslos</span>
			<strong>{(micropolisReactive.unemploymentRate * 100).toFixed(1)}%</strong>
		</div>
		<div class="metric">
			<span class="stat-label">Automatisierung</span>
			<strong>
				{(micropolisReactive.automationShare * 100).toFixed(1)}%
				{#if micropolisReactive.unrestEnabled}
					<span class="metric-secondary">/ Limit {(micropolisReactive.automationLimit * 100).toFixed(0)}%</span>
				{/if}
			</strong>
		</div>
		<div class="metric unrest-metric">
			<span class="stat-label">Unruhe</span>
			<strong>{unrestLabel}</strong>
		</div>
		<div class="metric">
			<span class="stat-label">Bevölkerung Menschen / KI</span>
			<strong><span class="human-stat">● {micropolisReactive.humanPopulation.toLocaleString()}</span> / <span class="ai-stat">◆ {micropolisReactive.aiPop.toLocaleString()}</span></strong>
		</div>
	</div>

	{#if micropolisReactive.podsEnabled}
		<div class="pods-status" aria-label="Pod-Status">
			<span class="pods-heading">Anlagen</span>
			<span>{micropolisReactive.bioPlantCount.toLocaleString()} Anlagen</span>
			<span>{micropolisReactive.boundHumans.toLocaleString()} gebundene Menschen</span>
			{#if micropolisReactive.aiFactionEnabled}
				<span>Politik {micropolisReactive.podPolicy === 1 ? 'verboten' : 'erlaubt'}</span>
			{/if}
			<span class="pod-events">
				+{micropolisReactive.podBirths.toLocaleString()} / −{micropolisReactive.podDeaths.toLocaleString()}
			</span>
		</div>
	{/if}

	{#if toolState.lastToolFeedback}
		<div class="hud-feedback" role="status">{toolState.lastToolFeedback}</div>
	{/if}
</section>

<style>
	.city-hud {
		position: absolute;
		top: 0.65rem;
		left: 0.65rem;
		z-index: 20;
		display: grid;
		gap: 0.6rem;
		width: min(28rem, calc(100% - 1.3rem));
		padding: 0.7rem 0.78rem;
		box-sizing: border-box;
		pointer-events: none;
		background: linear-gradient(145deg, rgba(6, 14, 27, 0.95), rgba(10, 24, 40, 0.91));
		border: 1px solid rgba(113, 190, 225, 0.3);
		border-radius: 8px;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35), inset 0 0 22px rgba(46, 133, 170, 0.07);
		backdrop-filter: blur(7px);
		color: #e9f4ff;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.8rem;
		line-height: 1.35;
		font-variant-numeric: tabular-nums;
	}

	.hud-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding-bottom: 0.48rem;
		border-bottom: 1px solid rgba(127, 182, 211, 0.18);
	}

	.city-funds,
	.date-status {
		display: grid;
		gap: 0.12rem;
	}

	.city-funds strong {
		color: #eafff5;
		font-size: 1.02rem;
		text-shadow: 0 0 9px rgba(94, 246, 194, 0.22);
	}

	.date-status {
		justify-items: end;
		color: #a8c0d5;
		text-align: right;
	}

	.date-status span:last-child {
		color: #77d7f2;
		font-weight: 700;
	}

	.date-status .paused {
		color: #ffc36b;
	}

	.stat-label {
		color: #88a2ba;
		font-size: 0.7rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.faction-cash {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.45rem;
	}

	.faction-stat {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: baseline;
		gap: 0.12rem 0.4rem;
		padding: 0.42rem 0.48rem;
		border: 1px solid rgba(145, 184, 209, 0.12);
		border-radius: 5px;
		background: rgba(255, 255, 255, 0.025);
	}

	.faction-name {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		font-weight: 700;
	}

	.human-stat .faction-name {
		color: #fbbf24;
	}

	.ai-stat .faction-name {
		color: #22d3ee;
	}

	.person-symbol {
		color: #fbbf24;
		font-size: 0.82rem;
		line-height: 0.8;
		text-shadow: 0 0 7px rgba(251, 191, 36, 0.65);
	}

	.ai-diamond {
		color: #22d3ee;
		text-shadow: 0 0 8px rgba(34, 211, 238, 0.8);
	}

	.faction-stat strong {
		font-size: 0.73rem;
		color: #f2f8ff;
	}

	.faction-caption {
		grid-column: 1 / -1;
		color: #8097aa;
		font-size: 0.54rem;
	}

	.status-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
	}

	.metric {
		display: grid;
		gap: 0.09rem;
		min-width: 0;
		padding: 0.34rem 0.42rem;
		border-left: 2px solid rgba(99, 197, 228, 0.38);
		background: rgba(37, 67, 91, 0.23);
	}

	.metric strong {
		overflow: hidden;
		color: #e1effa;
		font-size: 0.65rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.power-metric {
		border-color: #5bd9f1;
	}

	.unrest-metric {
		border-color: #fc9d72;
	}

	.metric-secondary {
		color: #9bb3c8;
		font-size: 0.57rem;
	}

	.pods-status {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.28rem 0.62rem;
		padding: 0.38rem 0.45rem;
		border: 1px solid rgba(62, 218, 238, 0.24);
		border-radius: 5px;
		background: rgba(15, 97, 119, 0.16);
		color: #aed5e4;
		font-size: 0.57rem;
	}

	.pods-heading {
		color: #58e2f5;
		font-weight: 700;
		text-transform: uppercase;
	}

	.pod-events {
		color: #91b4c8;
	}

	.hud-feedback {
		padding-top: 0.4rem;
		border-top: 1px solid rgba(255, 255, 255, 0.16);
		color: #ffc36b;
		font-size: 0.65rem;
		font-weight: 700;
	}

	@media (max-width: 740px) {
		.city-hud {
			top: 0.4rem;
			left: 0.4rem;
			width: min(25rem, calc(100% - 0.8rem));
			padding: 0.55rem;
			gap: 0.42rem;
		}
	}
</style>
