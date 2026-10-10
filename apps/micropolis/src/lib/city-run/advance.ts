import type { Micropolis } from '../../types/micropolisengine.d.js';

/**
 * Ticks exactly as `sim.advance` does, yielding after every tick so a view can
 * spread one year over animation frames without changing the result.
 */
export function* advanceMonthsStepwise(m: Micropolis, months: number): Generator<number, boolean, void> {
	const targetTime = m.cityTime + months * 4;
	const previousSpeed = m.simSpeed;
	const previousPasses = m.simPasses;
	m.setSpeed(3);
	m.setPasses(1);
	let guard = months * 4 * 32 + 32;
	try {
		while (m.cityTime < targetTime && guard-- > 0) {
			m.simTick();
			yield m.cityTime;
		}
		// phaseCycle names the NEXT phase: reaching 10 means phase 9 is complete.
		while (months > 0 && m.cityTime === targetTime &&
			Number.isInteger(m.phaseCycle) && m.phaseCycle >= 1 && m.phaseCycle <= 9 && guard-- > 0) {
			m.simTick();
			yield m.cityTime;
		}
	} finally {
		m.setSpeed(previousSpeed);
		m.setPasses(previousPasses);
	}
	return !(m.cityTime < targetTime || (months > 0 && m.phaseCycle >= 1 && m.phaseCycle <= 9));
}

export function advanceMonths(m: Micropolis, months: number): boolean {
	const steps = advanceMonthsStepwise(m, months);
	for (;;) {
		const next = steps.next();
		if (next.done) return next.value;
	}
}
