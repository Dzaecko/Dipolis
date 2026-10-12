<script lang="ts">
	import { commandBus } from '$lib/CommandBus';
	import { micropolisReactive } from '$lib/MicropolisReactive.svelte';
	import { gameToolGroupsForProfile, toolMenuLabel, UTILITY_TOOLS, type ToolId } from '$lib/gameTools';
	import { toolState } from '$lib/ToolState.svelte';

	const toolGroups = $derived(gameToolGroupsForProfile(micropolisReactive.podsEnabled));

	function selectTool(id: ToolId): void {
		toolState.setActiveTool(id);
	}

	async function setCitySetting(commandId: string, args: Record<string, unknown>): Promise<void> {
		try {
			const result = await commandBus.dispatch(commandId, {
				source: 'button',
				simulator: micropolisReactive.attachedSimulator,
				syncPowerState: micropolisReactive.syncPowerFromEngine,
				syncFoodState: micropolisReactive.syncFoodFromEngine,
				syncWelfareState: micropolisReactive.syncWelfareFromEngine,
				args,
			});
			if (result.handled === false) {
				toolState.setLastToolFeedback(result.message ?? 'Einstellung konnte nicht übernommen werden');
				return;
			}
			micropolisReactive.syncFromEngine();
			if (commandId === 'build.bio-plant') {
				const data = result.data;
				if (data === null || typeof data !== 'object' || !('built' in data) || data.built !== 1) {
					toolState.setLastToolFeedback('Keine Anlage gebaut: Kasse und verfügbare erschlossene Standorte prüfen.');
					return;
				}
				toolState.setLastToolFeedback('Eine Anlage wurde am verfügbaren Standort gebaut.');
				return;
			}
			toolState.setLastToolFeedback(null);
		} catch (error) {
			toolState.setLastToolFeedback(
				error instanceof Error
					? `Einstellung fehlgeschlagen: ${error.message}`
					: 'Einstellung fehlgeschlagen: Unbekannter Fehler',
			);
		}
	}

	function setTaxRate(event: Event): void {
		void setCitySetting('city.set-tax', {
			rate: Number((event.currentTarget as HTMLInputElement).value),
		});
	}

	function setWelfareLevel(event: Event): void {
		void setCitySetting('welfare.set-level', {
			level: Number((event.currentTarget as HTMLInputElement).value),
		});
	}

	function setAutomationLimit(event: Event): void {
		void setCitySetting('automation.set-limit', {
			limit: Number((event.currentTarget as HTMLInputElement).value),
		});
	}

	function setPowerPriority(event: Event): void {
		void setCitySetting('power.set-priority', {
			priority: Number((event.currentTarget as HTMLSelectElement).value),
		});
	}

	function setFoodImport(event: Event): void {
		void setCitySetting('food.set-import', {
			enabled: (event.currentTarget as HTMLInputElement).checked,
		});
	}

	function setPodIntake(event: Event): void {
		void setCitySetting('pods.set-intake', {
			source: (event.currentTarget as HTMLSelectElement).value,
		});
	}

	function setPodBreeding(event: Event): void {
		void setCitySetting('pods.set-breeding', {
			enabled: (event.currentTarget as HTMLInputElement).checked,
		});
	}

	function setAiThrottle(event: Event): void {
		void setCitySetting('ai.set-throttle', {
			level: Number((event.currentTarget as HTMLInputElement).value),
		});
	}
</script>

<nav class="toolbar" aria-label="Stadtwerkzeuge">
	<div class="toolbar-heading">
		<span class="toolbar-kicker">Dipolis</span>
		<span class="toolbar-title">Werkzeuge</span>
	</div>

	{#each toolGroups as group (group.id)}
		<section class="tool-group" class:people-group={group.id === 'people'} class:ai-group={group.id === 'ai'}>
			<h2 class="tool-group-label">
				{#if group.id === 'people'}
					<span class="person-symbol" aria-hidden="true">●</span>
				{:else if group.id === 'ai'}
					<span class="ai-diamond" aria-hidden="true">◆</span>
				{/if}
				{group.label}
			</h2>
			{#if group.id === 'facilities'}
				<button type="button" class="tool-item" onclick={() => void setCitySetting('build.bio-plant', { count: 1 })}>
					<span class="tool-name">Anlage bauen</span>
					<span class="tool-meta">Automatische Standortwahl</span>
				</button>
			{/if}
			{#each group.tools as tool (tool.id)}
				<button
					type="button"
					class="tool-item"
					class:active={toolState.activeToolId === tool.id}
					title="{tool.shortcut}: {toolMenuLabel(tool)}"
					onclick={() => selectTool(tool.id)}
				>
					<span class="tool-name">{tool.label}</span>
					<span class="tool-meta">${tool.cost.toLocaleString()} <kbd>{tool.shortcut}</kbd></span>
				</button>
			{/each}
		</section>
	{/each}

	<div class="utility-tools" aria-label="Stadtaktionen">
		{#each UTILITY_TOOLS as tool (tool.id)}
			<button
				type="button"
				class="utility-item"
				class:active={toolState.activeToolId === tool.id}
				title="{tool.shortcut}: {toolMenuLabel(tool)}"
				onclick={() => selectTool(tool.id)}
			>
				<span>{tool.label}</span>
				<kbd>{tool.shortcut}</kbd>
			</button>
		{/each}
	</div>

	<details class="settings-group">
		<summary>Einstellungen</summary>
		<div class="settings-controls">
			<label class="setting-control">
				<span>Steuern <strong>{micropolisReactive.cityTax}%</strong></span>
				<input
					type="range"
					min="0"
					max="20"
					step="1"
					value={micropolisReactive.cityTax}
					aria-label="Steuersatz"
					oninput={setTaxRate}
				/>
			</label>
			<label class="setting-control">
				<span>Grundversorgung <strong>{(micropolisReactive.welfareLevel * 100).toFixed(0)}%</strong></span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={micropolisReactive.welfareLevel}
					aria-label="Grundversorgung"
					oninput={setWelfareLevel}
				/>
			</label>
			<label class="setting-control">
				<span>Strompriorität</span>
				<select value={String(micropolisReactive.powerPriority)} onchange={setPowerPriority}>
					<option value="1">Menschen zuerst</option>
					<option value="0">Gleich verteilt</option>
					<option value="2">KI zuerst</option>
				</select>
			</label>
			{#if micropolisReactive.unrestEnabled}
				<label class="setting-control">
					<span>Automationslimit <strong>{(micropolisReactive.automationLimit * 100).toFixed(0)}%</strong></span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={micropolisReactive.automationLimit}
						aria-label="Automationslimit"
						oninput={setAutomationLimit}
					/>
				</label>
			{/if}
			<label class="import-control">
				<input
					type="checkbox"
					checked={micropolisReactive.foodImportEnabled}
					onchange={setFoodImport}
				/>
				<span>Nahrungsimporte</span>
				<strong>{micropolisReactive.foodImportEnabled ? 'An' : 'Aus'}</strong>
			</label>
			{#if micropolisReactive.podsEnabled}
				<div class="advanced-settings">
					<h3>Pod-System</h3>
					<label class="setting-control">
						<span>Aufnahmequelle</span>
						<select value={String(micropolisReactive.podIntake)} onchange={setPodIntake}>
							<option value="0">Keine</option>
							<option value="1">Arbeitslose</option>
							<option value="2">Einwohner</option>
						</select>
					</label>
					<label class="import-control">
						<input
							type="checkbox"
							checked={micropolisReactive.podBreeding}
							onchange={setPodBreeding}
						/>
						<span>Reproduktion</span>
						<strong>{micropolisReactive.podBreeding ? 'An' : 'Aus'}</strong>
					</label>
					<label class="setting-control">
						<span>KI-Drosselung <strong>{(micropolisReactive.aiThrottle * 100).toFixed(0)}%</strong></span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={micropolisReactive.aiThrottle}
							aria-label="KI-Drosselung"
							oninput={setAiThrottle}
						/>
					</label>
					{#if micropolisReactive.aiFactionEnabled}
						<label class="setting-control">
							<span>Pod-Politik</span>
							<select
								value={micropolisReactive.podPolicy === 1 ? 'forbidden' : 'allowed'}
								onchange={(event) => void setCitySetting('pods.set-policy', {
									policy: (event.currentTarget as HTMLSelectElement).value,
								})}
							>
								<option value="allowed">Erlaubt</option>
								<option value="forbidden">Verboten</option>
							</select>
						</label>
					{/if}
				</div>
			{/if}
		</div>
	</details>
</nav>

<style>
	.toolbar {
		flex: 0 0 14rem;
		width: 14rem;
		height: 100%;
		z-index: 20;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.38rem;
		margin: 0;
		padding: 0.65rem 0.55rem;
		overflow-x: hidden;
		overflow-y: auto;
		box-sizing: border-box;
		background: linear-gradient(180deg, rgba(8, 16, 31, 0.98), rgba(10, 22, 38, 0.97));
		border-right: 1px solid rgba(90, 187, 225, 0.28);
		box-shadow: 8px 0 28px rgba(0, 0, 0, 0.22), inset -1px 0 0 rgba(255, 255, 255, 0.035);
		color: #e8f3ff;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		contain: layout style;
		scrollbar-width: thin;
		scrollbar-color: #28506b transparent;
	}

	.toolbar-heading {
		display: grid;
		gap: 0.08rem;
		padding: 0.15rem 0.35rem 0.5rem;
		border-bottom: 1px solid rgba(113, 196, 231, 0.2);
	}

	.toolbar-kicker {
		color: #5bbfe3;
		font-size: 0.59rem;
		font-weight: 700;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.toolbar-title {
		color: #f1f7ff;
		font-size: 0.86rem;
		font-weight: 700;
	}

	.tool-group {
		padding: 0.32rem 0.28rem 0.2rem;
		border-bottom: 1px solid rgba(153, 196, 224, 0.13);
	}

	.tool-group-label {
		display: flex;
		align-items: center;
		gap: 0.38rem;
		margin: 0 0 0.22rem;
		padding: 0 0.12rem;
		color: #9eb6cf;
		font-size: 0.59rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}

	.person-symbol {
		color: #fbbf24;
		font-size: 0.83rem;
		line-height: 0.8;
		text-shadow: 0 0 7px rgba(251, 191, 36, 0.65);
	}

	.people-group .tool-group-label {
		color: #fbbf24;
	}

	.ai-diamond {
		color: #22d3ee;
		font-size: 0.9rem;
		line-height: 0.8;
		text-shadow: 0 0 8px rgba(57, 221, 255, 0.8);
	}

	.ai-group .tool-group-label {
		color: #63eaff;
	}

	.tool-item,
	.utility-item {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.35rem;
		margin: 0;
		padding: 0.29rem 0.42rem;
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		color: #d9e9f7;
		cursor: pointer;
		font: inherit;
		font-size: 0.66rem;
		line-height: 1.25;
		text-align: left;
	}

	.tool-item:hover,
	.utility-item:hover {
		border-color: rgba(112, 198, 234, 0.24);
		background: rgba(48, 104, 137, 0.2);
		color: #fff;
	}

	.tool-item.active,
	.utility-item.active {
		border-color: rgba(75, 201, 236, 0.45);
		background: linear-gradient(90deg, rgba(28, 123, 157, 0.36), rgba(29, 74, 108, 0.22));
		box-shadow: inset 2px 0 0 #54d9f2, 0 0 12px rgba(50, 177, 215, 0.1);
		color: #fff;
	}

	.people-group .tool-item.active {
		border-color: rgba(250, 189, 91, 0.42);
		background: linear-gradient(90deg, rgba(141, 91, 28, 0.35), rgba(76, 66, 47, 0.2));
		box-shadow: inset 2px 0 0 #fbbf24, 0 0 12px rgba(251, 191, 36, 0.1);
	}

	.ai-group .tool-item.active {
		border-color: rgba(34, 211, 238, 0.5);
		background: linear-gradient(90deg, rgba(18, 117, 142, 0.36), rgba(24, 73, 101, 0.2));
		box-shadow: inset 2px 0 0 #22d3ee, 0 0 12px rgba(34, 211, 238, 0.12);
	}

	.tool-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.32rem;
		color: #7893aa;
		font-size: 0.56rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	kbd {
		min-width: 0.9rem;
		padding: 0.05rem 0.16rem;
		border: 1px solid rgba(151, 190, 215, 0.22);
		border-radius: 3px;
		background: rgba(9, 18, 31, 0.8);
		color: #b5cde0;
		font: inherit;
		font-size: 0.55rem;
		text-align: center;
	}

	.utility-tools {
		display: flex;
		gap: 0.3rem;
		padding: 0.15rem 0.28rem 0.32rem;
	}

	.utility-item {
		border-color: rgba(151, 190, 215, 0.14);
		background: rgba(255, 255, 255, 0.025);
		font-size: 0.62rem;
	}

	.settings-group {
		margin: 0.1rem 0.25rem 0;
		border: 1px solid rgba(97, 181, 217, 0.22);
		border-radius: 6px;
		background: rgba(21, 45, 65, 0.35);
	}

	summary {
		padding: 0.42rem 0.52rem;
		color: #74d8f1;
		cursor: pointer;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.settings-controls {
		display: grid;
		gap: 0.62rem;
		padding: 0.18rem 0.55rem 0.65rem;
	}

	.advanced-settings {
		display: grid;
		gap: 0.62rem;
		padding-top: 0.55rem;
		border-top: 1px solid rgba(97, 181, 217, 0.2);
	}

	.advanced-settings h3 {
		margin: 0;
		color: #6edcf0;
		font-size: 0.59rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.setting-control {
		display: grid;
		gap: 0.22rem;
		color: #aac0d3;
		font-size: 0.59rem;
	}

	.setting-control span {
		display: flex;
		justify-content: space-between;
		gap: 0.35rem;
	}

	.setting-control strong,
	.import-control strong {
		color: #e3f5ff;
		font-variant-numeric: tabular-nums;
	}

	input[type='range'] {
		width: 100%;
		margin: 0.05rem 0;
		accent-color: #4bd7f2;
	}

	select {
		width: 100%;
		padding: 0.28rem 0.35rem;
		border: 1px solid rgba(115, 176, 206, 0.24);
		border-radius: 4px;
		background: #0e1d2d;
		color: #dcecff;
		font: inherit;
		font-size: 0.6rem;
	}

	.import-control {
		display: flex;
		align-items: center;
		gap: 0.38rem;
		color: #aac0d3;
		font-size: 0.59rem;
	}

	.import-control input {
		accent-color: #4bd7f2;
	}

	.import-control strong {
		margin-left: auto;
	}

	@media (max-width: 680px) {
		.toolbar {
			flex-basis: 11.5rem;
			width: 11.5rem;
			padding-inline: 0.35rem;
		}
	}
</style>
