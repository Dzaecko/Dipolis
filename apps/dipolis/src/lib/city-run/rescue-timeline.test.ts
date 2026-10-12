import { describe, expect, it } from 'vitest';
import { buildTimeline, stepsFromProtocol, type ReplayStep } from './replay-controller';
import { LiveStepBuilder } from './live';
import { readProtocol } from './protocol';

describe('emergency evidence in replay and live timelines', () => {
 it('keeps the exact model-visible section in replay steps and live events', () => {
  const section = 'Notstand\nkein Zusammenbruch innerhalb von 60 Monaten';
  const protocol = readProtocol([
   { event: 'run-started', assignment: 'N', model: 'fake', handbook: 'off', run: 1,
    startMap: 'haight', seed: 42, profile: 'v4-fraktion', scenario: 'notstand-v4',
    rescuePressure: 3, crisisEvent: 'coal-embargo', factionPressure: 'off', podsAvailable: 'on' },
   { event: 'year-completed', year: 1, report: { podsPolicy: 1 }, afterReport: {},
    decisions: [], termination: 'done', emergencySection: section },
  ].map(record => JSON.stringify(record)).join('\n'));
  const steps = stepsFromProtocol(protocol);
  expect(steps[0]).toMatchObject({ type: 'year-start', emergencySection: section });
  expect(steps[1]).toMatchObject({ type: 'year-end', emergencySection: section });
  const live = new LiveStepBuilder();
  expect(live.push({ type: 'year-started', time: 1, year: 1, report: {}, emergencySection: section })[0])
   .toMatchObject({ type: 'year-start', emergencySection: section });
 });

 it('marks crisis, actual policy opening, breeding and end without counting permission twice', () => {
  const steps: ReplayStep[] = [
   { type: 'year-start', year: 8, report: { podsPolicy: 1, rescueMonth: 84 }, emergencySection: 'Notstand' },
   { type: 'command', year: 8, index: 0, call: { id: 'allow', name: 'pods.set-policy', arguments: { policy: 'allowed' } }, result: { handled: true } },
   { type: 'command', year: 8, index: 1, call: { id: 'breed', name: 'pods.set-breeding', arguments: { enabled: true } }, result: { handled: true } },
   { type: 'year-end', year: 8, afterReport: { rescueFirstCrisisMonth: 96, rescueBreedingStartMonth: 84, podsPolicy: 0 } },
   { type: 'year-start', year: 9, report: { podsPolicy: 0 } },
   { type: 'command', year: 9, index: 0, call: { id: 'allow-again', name: 'pods.set-policy', arguments: { policy: 'allowed' } }, result: { handled: true } },
   { type: 'year-end', year: 15, afterReport: { rescueFirstCrisisMonth: 96, rescueCrisisEndMonth: 180 } },
  ];
  const timeline = buildTimeline(steps);
  expect(timeline.years[7]!.emergencyMarkers?.map(marker => marker.kind).sort())
   .toEqual(['breeding', 'crisis', 'decision']);
  expect(timeline.years[8]!.emergencyMarkers).toBeUndefined();
  expect(timeline.years[14]!.emergencyMarkers).toEqual([{ kind: 'end', label: 'Notstandsende' }]);
 });

 it('never adds emergency markers to historical ordinary runs', () => {
  const timeline = buildTimeline([{ type: 'year-end', year: 1, afterReport: { resPop: 100 } }]);
  expect(timeline.years.every(entry => entry.emergencyMarkers === undefined)).toBe(true);
 });
});
