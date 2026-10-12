<script lang="ts">
	import DipolisHero from '$lib/DipolisHero.svelte';
</script>

<svelte:head>
	<title>Dipolis</title>
	<meta name="description" content="Eine Stadt, in der Menschen und KI-Bewohner zusammenleben, geführt von einer KI-Verwaltung." />
</svelte:head>

<DipolisHero />

<section class="hub">
	<p class="lede">Eine Stadt, in der Menschen und KI-Bewohner zusammenleben, geführt von einer KI-Verwaltung.</p>
	<p class="population-key"><span class="human">● Menschen</span><span class="ai">◆ KI-Bewohner</span></p>
	<div class="cards">
		<a href="/replay?mode=live"><h2>Live-Lauf starten</h2><p>Entscheidungen der Verwaltung und den Stadtverlauf verfolgen.</p></a>
		<a href="/replay"><h2>Läufe wiedergeben</h2><p>Gespeicherte Entscheidungen mit der Engine nachvollziehen.</p></a>
		<a href="/results"><h2>Ergebnisse</h2><p>Kennzahlen, Jahresberichte und Nachbetrachtungen vergleichen.</p></a>
		<a href="/city"><h2>Freie Stadt</h2><p>Selbst bauen und die Versorgung der Bewohner verwalten.</p></a>
	</div>
</section>

<style>
	.hub { max-width: 64rem; margin: 0 auto; padding: 2rem 1.2rem; }
	.lede { font-size: 1.2rem; line-height: 1.6; }
	.population-key { display: flex; gap: 1.5rem; }
	.human { color: var(--human-color); }
	.ai { color: var(--ai-color); }
	.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 1rem; }
	.cards a { padding: 1.2rem; color: #e2e8f0; background: #121d30; border: 1px solid #30425e; border-radius: 0.65rem; }
	.cards a:hover { border-color: var(--ai-color); text-decoration: none; }
	h2 { margin-top: 0; font-weight: 700; color: #9edfff; }
</style>
