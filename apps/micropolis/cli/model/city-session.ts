import { commandBus } from '../../src/lib/CommandBus';
import { registerMicropolisCommands } from '../../src/lib/micropolisCommands';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';
import type { Dispatch } from './runner';

export async function createCitySession() {
 registerMicropolisCommands();
 const engine = await loadMicropolisMainModule();
 const m = new engine.Micropolis();
 m.setCallback(createNoopJsCallback(engine), {});
 const simulator = { micropolis: m, framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator;
 // The autonomous runner is the explicit authorization boundary. Using
 // script executes the pre-authorized allowlist rather than queuing UI approval.
 const dispatch: Dispatch = (id, args) => commandBus.dispatch(id, { source: 'script', simulator, args, actor: 'city-runner' });
 return { dispatch, close: () => m.delete() };
}