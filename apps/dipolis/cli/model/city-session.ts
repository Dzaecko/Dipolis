import { commandBus } from '../../src/lib/CommandBus';
import { registerMicropolisCommands } from '../../src/lib/micropolisCommands';
import { createEventCallback, CityEventLedger } from '../../src/lib/city-run/city-events';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';
import type { Dispatch } from './runner';

export async function createCitySession() {
 registerMicropolisCommands();
 const engine = await loadMicropolisMainModule();
 const m = new engine.Micropolis();
 const cityEvents = new CityEventLedger(engine, m);
 m.setCallback(createEventCallback(engine, cityEvents), {});
 const simulator = { micropolis: m, micropolisengine: engine, cityEvents,
  framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator & { cityEvents: CityEventLedger };
 // The autonomous runner is the explicit authorization boundary. Using
 // script executes the pre-authorized allowlist rather than queuing UI approval.
 const dispatch: Dispatch = (id, args) => commandBus.dispatch(id, { source: 'script', simulator, args, actor: 'city-runner' });
 return { dispatch, engine, micropolis: m, close: () => m.delete() };
}