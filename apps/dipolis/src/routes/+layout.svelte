<script lang="ts">
	import { page } from '$app/state';
	import './styles.css';
	let { children } = $props();
	const cityView = $derived(page.url.pathname === '/city' || page.url.pathname === '/replay');
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<div class="app-shell" class:city-view={cityView}>
	<header>
		<a class="brand" href="/">Dipolis</a>
		<nav aria-label="Hauptnavigation">
			<a href="/replay?mode=live">Live-Lauf</a>
			<a href="/replay">Wiedergabe</a>
			<a href="/results">Ergebnisse</a>
			<a href="/city">Freie Stadt</a>
			<a href="/about">Über Dipolis</a>
		</nav>
	</header>
	<main>{@render children()}</main>
	{#if !cityView}
		<footer>Dipolis · GPL-3 · <a href="/about">Herkunft und Änderungen</a> · <a href="https://github.com/Dzaecko/Dipolis">Quellcode</a></footer>
	{/if}
</div>

<style>
	.app-shell { min-height: 100dvh; display: flex; flex-direction: column; }
	header { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; padding: 0.8rem 1.2rem; background: #101827; border-bottom: 1px solid #30425e; }
	.brand { color: #f8fafc; font-family: var(--font-mono); font-size: 1.35rem; font-weight: 700; }
	nav { display: flex; flex-wrap: wrap; gap: 1rem; }
	nav a { color: #9edfff; }
	main { flex: 1; min-width: 0; }
	.city-view { height: 100dvh; overflow: hidden; }
	.city-view main { min-height: 0; display: flex; flex-direction: column; }
	footer { padding: 1rem; text-align: center; color: #a8b6cc; border-top: 1px solid #30425e; }
</style>
