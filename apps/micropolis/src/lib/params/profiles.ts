import classic from './classic.json';
import koexistenz from './koexistenz.json';
import unruhe from './v2-unruhe.json';
import pods from './v3-pods.json';

export const PROFILE_NAMES = ['classic', 'koexistenz', 'v2-unruhe', 'v3-pods'] as const;
export type SimulationProfile = typeof PROFILE_NAMES[number];
export const PROFILES = { classic, koexistenz, 'v2-unruhe': { ...koexistenz, ...unruhe },
 'v3-pods': { ...koexistenz, ...unruhe, ...pods } };
export function isSimulationProfile(value: unknown): value is SimulationProfile {
 return PROFILE_NAMES.some(name => name === value);
}
