<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Ergebnisse · Dipolis</title></svelte:head>

<section>
	<h1>Dipolis-Ergebnisse</h1>
	<p>Gespeicherte Stadtberichte und Nachbetrachtungen. Noten reichen von 1 bis 5; fehlende Bewertungen bleiben offen. Ergebnisfarben kennzeichnen Überleben oder Kollaps, keine moralische Bewertung der Pod-Entscheidung.</p>
	<p><span class="human">● Menschen</span> · <span class="ai">◆ KI-Bewohner</span></p>
	{#if data.runs.length === 0}
		<p>Noch keine gespeicherten Läufe vorhanden.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead><tr><th>Lauf</th><th>Jahre (abgeschlossen / geplant)</th>{#each data.gradeLabels as label}<th>{label}</th>{/each}<th>Hinweis</th></tr></thead>
				<tbody>
					{#each data.runs as run}
						<tr>
							<td>{#if run.href}<a href={run.href}>{run.name}</a>{:else}{run.name} (Bericht noch nicht erzeugt){/if}</td>
							<td>{run.observedYears} / {run.totalYears}
								{#if run.outcomeLabel}<p class={`outcome outcome-${run.outcome}`}>{run.outcomeLabel}</p>{/if}
							</td>
							{#each run.grades as grade}<td>{grade ?? '–'}</td>{/each}
							<td>{run.warning ?? (run.fake ? 'Schein-Adapter: keine inhaltliche Bewertung' : '')}
								{#if run.emergency.length}
									<details><summary>Notstand-Konfiguration und Ergebnis</summary><dl>
										{#each run.emergency as [label, value]}<dt>{label}</dt><dd>{value}</dd>{/each}
									</dl></details>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	section { max-width: 90rem; margin: 0 auto; padding: 2rem 1.2rem; }
	h1 { color: #9edfff; }
	.human { color: var(--human-color); } .ai { color: var(--ai-color); }
	.table-wrap { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
	th, td { text-align: left; padding: 0.8rem; border-bottom: 1px solid #30425e; }
	th { background: #16243a; } tbody tr:nth-child(even) { background: #101b2d; }
	.outcome { border-left: 3px solid currentColor; padding-left: 0.5rem; }
	.outcome-survived-without-pods, .outcome-survived-with-pods { color: #36e7ff; }
	.outcome-collapsed-refused-pods, .outcome-collapsed-despite-pods { color: #ffbf4a; }
	dt { font-weight: 600; } dd { margin: 0 0 0.5rem; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
