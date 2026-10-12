<script lang="ts">
	import titleImage from '../../../../docs/assets/dipolis-start.png';
</script>

<section class="hero" aria-labelledby="dipolis-title">
	<img
		src={titleImage}
		alt="Nächtliches Stadtpanorama mit warm beleuchteten Menschenvierteln und neonbeleuchteten KI-Vierteln"
		width="1792"
		height="768"
		fetchpriority="high"
	/>
	<h1 id="dipolis-title">Dipolis</h1>
</section>

<style>
	.hero {
		position: relative;
		width: 100%;
		height: clamp(18rem, 35vw, 36rem);
		overflow: hidden;
		isolation: isolate;
		container-type: inline-size;
		background: #11112c;
	}

	img {
		position: absolute;
		left: 50%;
		top: 0;
		transform: translateX(-50%);
		max-width: none;
		width: 1792px;
		height: 768px;
		image-rendering: pixelated;
	}

	@container (min-width: 3584px) {
		img {
			width: 3584px;
			height: 1536px;
		}
	}

	@container (min-width: 5376px) {
		img {
			width: 5376px;
			height: 2304px;
		}
	}

	@container (min-width: 7168px) {
		img {
			width: 7168px;
			height: 3072px;
		}
	}

	h1 {
		position: relative;
		z-index: 1;
		width: fit-content;
		margin: 0 auto;
		padding: 0.25em 0.6em;
		color: #ffe7bc;
		background: rgb(12 12 35 / 80%);
		font-family: 'Fira Mono', monospace;
		font-size: clamp(2.5rem, 7vw, 5rem);
		line-height: 1.2;
		letter-spacing: 0.06em;
		text-shadow: 3px 3px #532263;
	}
</style>
