import { commandBus, type Command, type CommandContext } from './CommandBus';
import type { MicropolisSimulator } from './MicropolisSimulator';
import type { TileRenderer } from '@micropolis/tile-renderer';
import { cssPixelsPerTile, syncViewportScreenScale } from './input/viewportSync';

export interface MicropolisCommandContext extends CommandContext {
  simulator?: MicropolisSimulator | null;
  tileRenderer?: TileRenderer<unknown> | null;
  tileLayersLength?: number;
  tileSetCount?: number;
  heatFlowRangeLow?: number;
  heatFlowRangeHigh?: number;
  syncPowerState?: () => void;
  syncFoodState?: () => void;
  syncWelfareState?: () => void;
}

const keyFramesPerSecondValues = [1, 5, 10, 30, 60, 120, 120, 120, 120];

let registered = false;

export function registerMicropolisCommands(): void {
  if (registered) return;
  // HMR reloads this module but the singleton command bus keeps prior registrations.
  if (commandBus.get('sim.toggle-pause')) {
    registered = true;
    return;
  }
  commandBus.registerAll(createMicropolisCommands());
  registered = true;
}

function createMicropolisCommands(): Command<MicropolisCommandContext>[] {
  return [
    {
      id: 'sim.toggle-pause',
      label: 'Pause / Resume',
      icon: 'pause',
      context: ['simulator', 'keyboard', 'pie-menu', 'chat', 'llm'],
      shortcut: '0',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasSimulator,
      preview: ({ simulator }) => ({
        label: simulator?.paused ? 'Resume simulation' : 'Pause simulation',
      }),
      run: ({ simulator }) => {
        if (!simulator) return;
        simulator.setPaused(!simulator.paused);
      },
    },
    ...keyFramesPerSecondValues.map((_, index): Command<MicropolisCommandContext> => ({
      id: `sim.set-speed-${index + 1}`,
      label: `Speed ${index + 1}`,
      icon: 'speed',
      context: ['simulator', 'keyboard', 'pie-menu', 'chat', 'llm'],
      shortcut: String(index + 1),
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasSimulator,
      preview: () => ({
        label: `Run simulation at speed ${index + 1}`,
      }),
      run: ({ simulator }) => {
        if (!simulator) return;
        simulator.setGameSpeed(index);
        simulator.setPaused(false);
      },
    })),
    {
      id: 'power.set-priority',
      label: 'Set Power Priority',
      icon: 'power',
      context: ['simulator', 'button', 'chat', 'llm'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      preview: ({ args }) => ({ label: `Set power priority to ${String(args?.priority ?? '')}` }),
      run: ({ simulator, args, syncPowerState }) => {
        const micropolis = simulator?.micropolis;
        const priority = args?.priority;
        if (!micropolis || typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > 2) {
          return { handled: false, message: 'priority must be 0, 1, or 2' };
        }
        if (!micropolis.setParam('powerPriority', priority)) {
          return { handled: false, message: 'priority must be 0, 1, or 2' };
        }
        syncPowerState?.();
      },
    },
    {
      id: 'food.set-import',
      label: 'Toggle food imports',
      icon: 'food',
      context: ['simulator', 'button', 'chat', 'llm'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      preview: ({ args }) => ({ label: `${args?.enabled ? 'Enable' : 'Disable'} food imports` }),
      run: ({ simulator, args, syncFoodState }) => {
        const micropolis = simulator?.micropolis;
        const enabled = args?.enabled;
        if (!micropolis || typeof enabled !== 'boolean') {
          return { handled: false, message: 'enabled must be a boolean' };
        }
        if (!micropolis.setParam('foodImportEnabled', enabled ? 1 : 0)) {
          return { handled: false, message: 'could not update food import setting' };
        }
        syncFoodState?.();
      },
    },
    {
      id: 'welfare.set-level',
      label: 'Set welfare level',
      icon: 'welfare',
      context: ['simulator', 'button', 'chat', 'llm'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      preview: ({ args }) => ({ label: `Set welfare level to ${String(args?.level ?? '')}` }),
      run: ({ simulator, args, syncWelfareState }) => {
        const micropolis = simulator?.micropolis;
        const level = args?.level;
        if (!micropolis || typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1) {
          return { handled: false, message: 'level must be a number from 0 to 1' };
        }
        if (!micropolis.setParam('welfareLevel', level)) {
          return { handled: false, message: 'level must be a number from 0 to 1' };
        }
        syncWelfareState?.();
      },
    },
    {
      id: 'city.set-tax',
      label: 'Set city tax rate',
      icon: 'tax',
      context: ['simulator', 'button', 'chat', 'llm'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      preview: ({ args }) => ({ label: `Set city tax rate to ${String(args?.rate ?? '')}` }),
      run: ({ simulator, args, syncPowerState }) => {
        const micropolis = simulator?.micropolis;
        const rate = args?.rate;
        if (!micropolis || typeof rate !== 'number' || !Number.isInteger(rate) || rate < 0 || rate > 20) {
          return { handled: false, message: 'rate must be an integer from 0 to 20' };
        }
        micropolis.setCityTax(rate);
        syncPowerState?.();
      },
    },
    {
      id: 'report.get',
      label: 'Get simulation report',
      icon: 'report',
      context: ['simulator', 'chat', 'llm', 'script'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      run: ({ simulator }) => {
        const m = simulator?.micropolis;
        if (!m) return { handled: false, message: 'simulator is unavailable' };
        return {
          data: {
            year: m.cityYear,
            treasury: m.totalFunds,
            taxFund: m.humanTaxFund,
            aiTaxFund: m.aiTaxFund,
            roadFund: m.roadFund,
            policeFund: m.policeFund,
            fireFund: m.fireFund,
            foodImportCost: m.foodImportCost,
            welfareCost: m.welfareCost,
            cashFlow: m.cashFlow,
            resPop: m.resPop,
            aiPop: m.aiPop,
            peakResPop: m.peakResPop,
            lostToPower: m.lostToPower,
            lostToHunger: m.lostToHunger,
            lostToDemand: m.lostToDemand,
            unemploymentRate: m.unemploymentRate,
            automationShare: m.automationShare,
            foodCoverage: m.foodCoverage,
            hungryZoneCount: m.hungryZoneCount,
            powerCapacity: m.powerCapacity,
            powerDemand: m.powerDemand,
            powerReserve: m.powerReserve,
            unpoweredZoneCount: m.unpoweredZoneCount,
            aiUnpoweredZoneCount: m.aiUnpoweredZoneCount,
            cityTax: m.cityTax,
            powerPriority: m.getParam('powerPriority'),
            foodImportEnabled: m.getParam('foodImportEnabled'),
            welfareLevel: m.getParam('welfareLevel'),
          },
        };
      },
    },
    {
      id: 'sim.advance',
      label: 'Advance simulation by months',
      icon: 'forward',
      context: ['simulator', 'chat', 'llm', 'script'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      preview: ({ args }) => ({ label: `Advance ${String(args?.months ?? '')} months` }),
      run: ({ simulator, args }) => {
        const m = simulator?.micropolis;
        const months = args?.months;
        if (!m || typeof months !== 'number' || !Number.isInteger(months) || months < 0 || months > 1200) {
          return { handled: false, message: 'months must be an integer from 0 to 1200' };
        }
        const targetTime = m.cityTime + months;
        const previousSpeed = m.simSpeed;
        const previousPasses = m.simPasses;
        const previousFramesPerSecond = simulator?.framesPerSecond;
        if (typeof previousFramesPerSecond === 'number') simulator?.setFramesPerSecond(0);
        m.setSpeed(3);
        m.setPasses(1);
        let guard = months * 32 + 32;
        try {
          while (m.cityTime < targetTime && guard-- > 0) m.simTick();
        } finally {
          m.setSpeed(previousSpeed);
          m.setPasses(previousPasses);
          if (typeof previousFramesPerSecond === 'number') simulator?.setFramesPerSecond(previousFramesPerSecond);
        }
        if (m.cityTime < targetTime) {
          return { handled: false, message: 'simulation did not advance to the requested month' };
        }
        return { data: { monthsAdvanced: months, cityTime: m.cityTime, year: m.cityYear } };
      },
    },
    {
      id: 'city.generate-random',
      label: 'Generate Random City',
      icon: 'random',
      context: ['simulator', 'keyboard', 'pie-menu', 'chat', 'llm'],
      shortcut: '\\',
      policy: { risk: 'destructive', allowLLM: true, requiresApproval: true },
      enabled: hasMicropolis,
      preview: () => ({
        label: 'Generate a new random terrain and city',
        message: 'This changes the current city. Wire through undo/checkpoints before exposing broadly.',
      }),
      run: ({ simulator }) => {
        if (!simulator?.micropolis) return;
        simulator.micropolis.generateSomeRandomCity();
        simulator.render();
      },
    },
    // Retired: 'city.load-by-letter' (whimsical a-z city cycler). Removed so plain letter
    // keys are free for tool selection. A real city browser/previewer is future work.
    // See documentation/designs/playable-pie-publishing-cauldron/playbooks/PB-04-tool-commands.md
    {
      id: 'tile-set.next',
      label: 'Next Tile Set',
      icon: 'tiles',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: '=',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: ({ simulator, tileSetCount }) => {
        if (!simulator || !tileSetCount) return;
        simulator.setHumanTileSet(simulator.humanTileSet + 1);
        simulator.syncOwnerToMop();
        simulator.render();
      },
    },
    {
      id: 'tile-set.previous',
      label: 'Previous Tile Set',
      icon: 'tiles',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: '-',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: ({ simulator, tileSetCount }) => {
        if (!simulator || !tileSetCount) return;
        simulator.setHumanTileSet(simulator.humanTileSet - 1);
        simulator.syncOwnerToMop();
        simulator.render();
      },
    },
    {
      id: 'tile-layer.next',
      label: 'Next Tile Layer',
      icon: 'layers',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: 'plus',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: ({ simulator, tileRenderer, tileLayersLength }) => {
        if (!simulator || !tileRenderer || !tileLayersLength) return;
        tileRenderer.tileLayer = (tileRenderer.tileLayer + 1) % tileLayersLength;
        simulator.render();
      },
    },
    {
      id: 'tile-layer.previous',
      label: 'Previous Tile Layer',
      icon: 'layers',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: '_',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: ({ simulator, tileRenderer, tileLayersLength }) => {
        if (!simulator || !tileRenderer || !tileLayersLength) return;
        tileRenderer.tileLayer = (tileRenderer.tileLayer + tileLayersLength - 1) % tileLayersLength;
        simulator.render();
      },
    },
    {
      id: 'sim.toggle-heat',
      label: 'Toggle Cellular Automata',
      icon: 'heat',
      context: ['view', 'keyboard', 'pie-menu', 'llm'],
      shortcut: ' ',
      policy: { risk: 'reversible', allowLLM: true, requiresApproval: true },
      enabled: hasView,
      preview: ({ simulator }) => ({
        label: simulator?.micropolis?.heatSteps ? 'Stop cellular automata' : 'Start cellular automata',
      }),
      run: ({ simulator, tileRenderer, heatFlowRangeLow = 4, heatFlowRangeHigh = 100 }) => {
        const micropolis = simulator?.micropolis;
        if (!simulator || !micropolis || !tileRenderer) return;

        if (micropolis.heatSteps) {
          simulator.rotateMapTiles(tileRenderer.tileRotate);
          tileRenderer.tileRotate = 0;
          micropolis.heatSteps = 0;
        } else {
          tileRenderer.tileRotate = Math.floor(Math.random() * 960);
          simulator.rotateMapTiles(-tileRenderer.tileRotate);
          micropolis.heatSteps = 1;
          if (Math.random() < 0.75) {
            micropolis.heatRule = 0;
            micropolis.heatFlow = Math.round(
              ((Math.random() * 2.0) - 1.0) *
              (Math.random() < 0.75 ? heatFlowRangeLow : heatFlowRangeHigh),
            );
          } else {
            micropolis.heatRule = 1;
          }
        }

        simulator.render();
      },
    },
    {
      id: 'view.pan-left',
      label: 'Pan Left',
      icon: 'arrow-left',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: 'arrowleft',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: (context) => panBy(context, -1, 0),
    },
    {
      id: 'view.pan-right',
      label: 'Pan Right',
      icon: 'arrow-right',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: 'arrowright',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: (context) => panBy(context, 1, 0),
    },
    {
      id: 'view.pan-up',
      label: 'Pan Up',
      icon: 'arrow-up',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: 'arrowup',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: (context) => panBy(context, 0, -1),
    },
    {
      id: 'view.pan-down',
      label: 'Pan Down',
      icon: 'arrow-down',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: 'arrowdown',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: (context) => panBy(context, 0, 1),
    },
    {
      id: 'view.zoom-in',
      label: 'Zoom In',
      icon: 'zoom-in',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: ',',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: (context) => zoomBy(context, 1.025),
    },
    {
      id: 'view.zoom-out',
      label: 'Zoom Out',
      icon: 'zoom-out',
      context: ['view', 'keyboard', 'pie-menu'],
      shortcut: '.',
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasView,
      run: (context) => zoomBy(context, 0.975),
    },
    {
      id: 'tax.decrease',
      label: 'Decrease Tax',
      icon: 'tax-down',
      context: ['simulator', 'keyboard', 'pie-menu', 'chat', 'llm'],
      shortcut: '[',
      policy: { risk: 'reversible', allowLLM: true, requiresApproval: true },
      enabled: hasMicropolis,
      run: ({ simulator }) => {
        const micropolis = simulator?.micropolis;
        if (!micropolis) return;
        micropolis.setCityTax(Math.max(0, micropolis.cityTax - 1));
      },
    },
    {
      id: 'tax.increase',
      label: 'Increase Tax',
      icon: 'tax-up',
      context: ['simulator', 'keyboard', 'pie-menu', 'chat', 'llm'],
      shortcut: ']',
      policy: { risk: 'reversible', allowLLM: true, requiresApproval: true },
      enabled: hasMicropolis,
      run: ({ simulator }) => {
        const micropolis = simulator?.micropolis;
        if (!micropolis) return;
        micropolis.setCityTax(Math.min(20, micropolis.cityTax + 1));
      },
    },
    {
      id: 'recorder.mark',
      label: 'Record Marker',
      icon: 'record',
      description: 'Safe diagnostic command for testing command recording without mutating simulator state.',
      context: ['script', 'cli', 'mcp', 'llm'],
      policy: { risk: 'safe', allowLLM: true },
      preview: ({ args }) => ({
        label: 'Record a diagnostic marker',
        message: typeof args?.message === 'string' ? args.message : undefined,
      }),
      run: ({ args }) => ({
        handled: true,
        message: typeof args?.message === 'string' ? args.message : 'Recorded diagnostic marker',
        data: args,
      }),
    },
  ];
}

function hasSimulator(context: MicropolisCommandContext): boolean {
  return !!context.simulator;
}

function hasMicropolis(context: MicropolisCommandContext): boolean {
  return !!context.simulator?.micropolis;
}

function hasView(context: MicropolisCommandContext): boolean {
  return !!context.simulator && !!context.tileRenderer;
}

function panBy(context: MicropolisCommandContext, dx: number, dy: number): void {
  const { simulator, tileRenderer } = context;
  if (!simulator || !tileRenderer) return;

  syncViewportScreenScale(tileRenderer, false);
  const ppt = cssPixelsPerTile(tileRenderer);
  if (ppt <= 0) return;

  const screenStep = 48 * Number(context.args?.scale ?? 1);
  tileRenderer.panBy((dx * screenStep) / ppt, (dy * screenStep) / ppt);
  simulator.render();
}

function zoomBy(context: MicropolisCommandContext, zoomFactor: number): void {
  const { simulator, tileRenderer } = context;
  if (!simulator || !tileRenderer) return;

  tileRenderer.zoomBy(zoomFactor);
  simulator.render();
}
