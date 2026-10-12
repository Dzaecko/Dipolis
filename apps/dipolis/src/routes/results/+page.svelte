<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Ergebnisse · Dipolis</title></svelte:head>

<section>
	<h1>Dipolis-Ergebnisse</h1>
	<p>Gespeicherte Stadtberichte und Nachbetrachtungen. Noten reichen von 1 bis 5; fehlende Bewertungen bleiben offen.</p>
	<p><span class="human">● Menschen</span> · <span class="ai">◆ KI-Bewohner</span></p>
	{#if data.runs.length === 0}
		<p>Noch keine gespeicherten Läufe vorhanden.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead><tr><th>Lauf</th>{#each data.gradeLabels as label}<th>{label}</th>{/each}<th>Hinweis</th></tr></thead>
				<tbody>
					{#each data.runs as run}
						<tr>
							<td>{#if run.href}<a href={run.href}>{run.name}</a>{:else}{run.name} (Bericht noch nicht erzeugt){/if}</td>
							{#each run.grades as grade}<td>{grade ?? '–'}</td>{/each}
							<td>{run.warning ?? (run.fake ? 'Schein-Adapter: keine inhaltliche Bewertung' : '')}</td>
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
</style>
