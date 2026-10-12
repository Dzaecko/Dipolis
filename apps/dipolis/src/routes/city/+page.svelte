<script lang="ts">
	import MicropolisView from '$lib/MicropolisView.svelte';
	import { page } from '$app/state';
	import { PROFILE_NAMES, isSimulationProfile } from '$lib/params/profiles';

	const pageHeadTitle = 'Dipolis';
	const pageDescription = 'Dipolis, eine Stadtbausimulation für Menschen und KI.';
	const selectedProfile = $derived(page.url.searchParams.get('profile') ?? 'koexistenz');
	const profile = $derived(isSimulationProfile(selectedProfile) ? selectedProfile : null);
</script>

<svelte:head>
	<title>{pageHeadTitle}</title>
	{#if pageDescription}
		<meta name="description" content={pageDescription} />
	{/if}
</svelte:head>

<div class="micropolis-container">
	<form action="/city" method="get" class="profile-picker">
		<label>Regelprofil <select name="profile" value={profile ?? 'koexistenz'}>
			{#each PROFILE_NAMES as name}<option value={name}>{name}</option>{/each}
		</select></label>
		<button type="submit">Neue freie Stadt</button>
		<span>Der Neustart verwirft die aktuelle freie Stadt.</span>
	</form>
	{#if profile}
		{#key profile}<MicropolisView {profile} />{/key}
	{:else}
		<p role="alert">Unbekanntes Regelprofil: {selectedProfile}</p>
	{/if}
</div>

<style>
	.micropolis-container {
		display: flex;
		flex-direction: column;
		position: relative;
		width: 100%;
		height: 100%;
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
	.profile-picker { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding: 0.6rem; background: #101b2d; font-size: 0.85rem; }
	.profile-picker span { color: #a8b6cc; }
</style>
