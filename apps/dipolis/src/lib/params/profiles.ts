import classic from './classic.json';
import koexistenz from './koexistenz.json';
import unruhe from './v2-unruhe.json';
import pods from './v3-pods.json';
// v4's fixed initial weights target 100 minus coverage/throttle/fire/priority
// penalties, plus new-lot credit; 0.15 moves monthly toward that target.
import fraktion from './v4-fraktion.json';
const { rescue, ...fraktionNumeric } = fraktion;
export const RESCUE_PARAMS = rescue;

export const PROFILE_NAMES = ['classic', 'koexistenz', 'v2-unruhe', 'v3-pods', 'v4-fraktion'] as const;
export type SimulationProfile = typeof PROFILE_NAMES[number];
export const PROFILES = { classic, koexistenz, 'v2-unruhe': { ...koexistenz, ...unruhe },
 'v3-pods': { ...koexistenz, ...unruhe, ...pods },
 'v4-fraktion': { ...koexistenz, ...unruhe, ...pods, ...fraktionNumeric } };
export function isSimulationProfile(value: unknown): value is SimulationProfile {
 return PROFILE_NAMES.some(name => name === value);
}
