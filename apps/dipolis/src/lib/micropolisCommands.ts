import { commandBus, type Command, type CommandContext } from './CommandBus';
import type { MicropolisSimulator } from './MicropolisSimulator';
import type { TileRenderer } from '@micropolis/tile-renderer';
import { cssPixelsPerTile, syncViewportScreenScale } from './input/viewportSync';
import { PROFILES, isSimulationProfile } from './params/profiles';
import { advanceMonths } from './city-run/advance';

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

// Transitional typing until the engine agent regenerates the WASM declarations.
type ScenarioEngine = NonNullable<MicropolisSimulator['micropolis']> & {
  autoBuild?: (kind: number, count: number) => number;
  getAiZoneCount?: () => number;
  setServiceFunding?: (road: number, police: number, fire: number) => void;
  roadPercent: number;
  policePercent: number;
  firePercent: number;
};

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
      id: 'scenario.start',
      label: 'Start deterministic Haight scenario',
      icon: 'random',
      context: ['script'],
      policy: { risk: 'destructive', allowLLM: false },
      enabled: (context) => context.source === 'script' && hasMicropolis(context),
      run: ({ simulator, args }) => {
        const m = simulator?.micropolis;
        const seed = args?.seed === undefined ? 42 : args.seed;
        const city = args?.city ?? 'haight';
        const autoBuildRules = args?.autoBuildRules === undefined ? (city === 'natural' ? 1 : 0) : args.autoBuildRules;
        // A closed preset prevents arbitrary paths, profiles, or implicit unsafe settings.
        if (!m || !args || Object.keys(args).some((key) =>
          !['city', 'profile', 'seed', 'disasters', 'speed', 'autoBuildRules'].includes(key)) ||
          (autoBuildRules !== 0 && autoBuildRules !== 1) ||
          (city !== 'haight' && city !== 'natural') || !isSimulationProfile(args.profile) ||
          typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0 || seed > 0x7fffffff ||
          typeof args.disasters !== 'boolean' || args.speed !== 3) {
          return { handled: false, message: 'expected city haight or natural, profile classic/koexistenz/v2-unruhe/v3-pods/v4-fraktion, seed 0..2147483647, disasters boolean, speed 3' };
        }
        // The caller owns the callback and establishes it before dispatching this command.
        m.setFixedSeed(seed);
        m.init();
        for (const [name, value] of Object.entries({
          foodImportEnabled: 0, foodImportPrice: 0, jobsPerAiPop: 0,
          welfareLevel: 0, welfareCostPerPop: 0, automationLimit: 0.9,
          automationYieldPerJob: 0
        })) m.setParam(name, value);
        m.setParam('unrestEnabled', 0);
        m.setParam('podsEnabled', 0);
        m.setParam('aiFactionEnabled', 0);
        m.setParam('aiAutonomousPods', 0);
        m.setParam('foundingEnabled', city === 'natural' ? autoBuildRules : 0);
        for (const [name, value] of Object.entries(PROFILES[args.profile])) {
          if (!m.setParam(name, value)) return { handled: false, message: `could not set scenario parameter ${name}` };
        }
        m.setEnableDisasters(args.disasters);
        if (city === 'haight') {
          if (!m.loadCity('/cities/haight.cty')) return { handled: false, message: 'could not load Haight' };
        } else {
          m.generateSomeRandomCity();
        }
        m.setSpeed(3);
        m.setPasses(1);
        return { data: { city, profile: args.profile, seed, disasters: args.disasters, speed: 3, passes: 1 } };
      },
    },
    {
      id: 'scenario.stromkrise',
      label: 'Set up fixed power crisis',
      icon: 'power', context: ['script'],
      policy: { risk: 'destructive', allowLLM: false }, enabled: hasMicropolis,
      run: ({ simulator }) => {
        const m = simulator?.micropolis;
        const engine = simulator?.micropolisengine;
        if (!m || !engine || m.getParam('podsEnabled') !== 1)
          return { handled: false, message: 'Stromkrise requires v3-pods or v4-fraktion' };
        const centers: Array<{ x: number; y: number }> = [];
        for (let x = 0; x < engine.WORLD_W; ++x) for (let y = 0; y < engine.WORLD_H; ++y) {
          const value = m.getTile(x, y);
          const tile = value & engine.MapTileBits.LOMASK.value;
          if ((value & engine.MapTileBits.ZONEBIT.value) &&
            (tile === engine.Tiles.POWERPLANT.value || tile === engine.Tiles.NUCLEAR.value))
            centers.push({ x, y });
        }
        if (centers.length < 2) return { handled: false, message: 'Stromkrise needs two actual plants' };
        for (const { x, y } of centers.slice(0, 2)) {
          if (m.doTool(engine.EditingTool.TOOL_BULLDOZER, x, y).value !== engine.ToolResult.TOOLRESULT_OK.value)
            return { handled: false, message: 'could not demolish power plant' };
        }
        m.setParam('powerPlantCostMultiplier', 3);
        return { data: { demolished: centers.slice(0, 2), powerPlantCostMultiplier: 3 } };
      },
    },
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
      id: 'automation.set-limit',
      label: 'Set automation limit',
      icon: 'welfare',
      context: ['simulator', 'button', 'chat', 'llm'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      run: ({ simulator, args }) => {
        const m = simulator?.micropolis;
        const limit = args?.limit;
        if (!m || m.getParam('unrestEnabled') !== 1 || typeof limit !== 'number' ||
          !Number.isFinite(limit) || limit < 0 || limit > 1 ||
          !m.setParam('automationLimit', limit)) return { handled: false, message: 'v2-unruhe requires limit from 0 to 1' };
        return { data: { limit: m.getParam('automationLimit'), cost: 0 } };
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
    ...['city.set-tax', 'tax.set'].map((id): Command<MicropolisCommandContext> => ({
      id,
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
        return { data: { built: 0, cost: 0, rate: micropolis.cityTax } };
      },
    })),
    ...[
      { id: 'build.residential', kind: 0, label: 'Build human residential zones' },
      { id: 'build.ai-zones', kind: 1, label: 'Build AI residential zones' },
      { id: 'build.farms', kind: 2, label: 'Build farms' },
      { id: 'build.bio-plant', kind: 5, label: 'Build bio plants' },
    ].map(({ id, kind, label }): Command<MicropolisCommandContext> => ({
      id,
      label,
      icon: 'build',
      context: ['simulator', 'chat', 'llm', 'script'],
      policy: { risk: 'reversible', allowLLM: true, requiresApproval: true },
      enabled: hasMicropolis,
      run: ({ simulator, args }) => {
        const count = args?.count;
        if (kind === 5 && simulator?.micropolis?.getParam('podsEnabled') !== 1)
          return { handled: false, message: 'bio plants require v3-pods' };
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 1000) {
          return { handled: false, message: 'count must be an integer from 0 to 1000' };
        }
        return autoBuild(simulator?.micropolis, kind, count);
      },
    })),
    {
      id: 'pods.set-policy', label: 'Set autonomous AI pod policy', icon: 'power',
      context: ['simulator', 'button', 'chat', 'llm', 'script'],
      policy: { risk: 'safe', allowLLM: true }, enabled: hasMicropolis,
      run: ({ simulator, args }) => {
        const m = simulator?.micropolis;
        const policy = args?.policy;
        if (!m || m.getParam('aiFactionEnabled') !== 1 || m.getParam('podsEnabled') !== 1 ||
          !args || Object.keys(args).length !== 1 || (policy !== 'allowed' && policy !== 'forbidden') ||
          !m.setParam('podsPolicy', policy === 'forbidden' ? 1 : 0))
          return { handled: false, message: 'invalid v4-fraktion pod policy' };
        return { data: { policy, cost: 0 } };
      },
    },
    ...[
      { id: 'pods.set-intake', param: 'podIntake', key: 'source' },
      { id: 'pods.set-breeding', param: 'podBreeding', key: 'enabled' },
      { id: 'ai.set-throttle', param: 'aiThrottle', key: 'level' },
    ].map(({ id, param, key }): Command<MicropolisCommandContext> => ({
      id, label: id, icon: 'power', context: ['simulator', 'button', 'chat', 'llm', 'script'],
      policy: { risk: 'safe', allowLLM: true }, enabled: hasMicropolis,
      run: ({ simulator, args }) => {
        const m = simulator?.micropolis;
        const raw = args?.[key];
        const value = key === 'source' ? (typeof raw === 'string' ? ['none', 'unemployed', 'residents'].indexOf(raw) : NaN)
          : key === 'enabled' ? (typeof raw === 'boolean' ? Number(raw) : NaN) : raw;
        if (!m || m.getParam('podsEnabled') !== 1 || typeof value !== 'number' ||
          !Number.isFinite(value) || !m.setParam(param, value))
          return { handled: false, message: 'invalid v3-pods control' };
        return { data: { [key]: raw, cost: 0 } };
      },
    })),
    {
      id: 'build.power-plant',
      label: 'Build a power plant',
      icon: 'power',
      context: ['simulator', 'chat', 'llm', 'script'],
      policy: { risk: 'reversible', allowLLM: true, requiresApproval: true },
      enabled: hasMicropolis,
      run: ({ simulator, args }) => {
        const type = args?.type;
        if (type !== 'coal' && type !== 'nuclear') {
          return { handled: false, message: 'type must be coal or nuclear' };
        }
        return autoBuild(simulator?.micropolis, type === 'coal' ? 3 : 4, 1);
      },
    },
    {
      id: 'budget.set-funding',
      label: 'Set service funding percentages',
      icon: 'tax',
      context: ['simulator', 'chat', 'llm', 'script'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      run: ({ simulator, args }) => {
        const m = simulator?.micropolis as ScenarioEngine | undefined;
        const road = args?.road;
        const police = args?.police;
        const fire = args?.fire;
        if (!isFundingPercent(road) || !isFundingPercent(police) || !isFundingPercent(fire)) {
          return { handled: false, message: 'road, police, and fire must all be finite numbers from 0 to 100' };
        }
        if (!m?.setServiceFunding) {
          return { handled: false, message: 'engine setServiceFunding binding is unavailable' };
        }
        m.setServiceFunding(road / 100, police / 100, fire / 100);
        return { data: { built: 0, cost: 0, road, police, fire } };
      },
    },
    {
      id: 'treasury.set',
      label: 'Set scenario treasury',
      icon: 'tax',
      context: ['simulator', 'script'],
      policy: { risk: 'destructive', allowLLM: false },
      enabled: hasMicropolis,
      run: ({ simulator, args }) => {
        const m = simulator?.micropolis;
        const amount = args?.amount;
        if (!m || typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > 2147483647) {
          return { handled: false, message: 'amount must be an integer from 0 to 2147483647' };
        }
        m.setFunds(amount);
        return { data: { built: 0, cost: 0, totalFunds: m.totalFunds } };
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
        const m = simulator?.micropolis as ScenarioEngine | undefined;
        if (!m) return { handled: false, message: 'simulator is unavailable' };
        if (!m.getAiZoneCount) return { handled: false, message: 'engine getAiZoneCount binding is unavailable' };
        return {
          data: {
            year: m.cityYear,
            treasury: m.totalFunds,
            taxFund: m.humanTaxFund,
            aiTaxFund: m.aiTaxFund,
            roadFund: m.roadFund,
            policeFund: m.policeFund,
            fireFund: m.fireFund,
            roadFundingPercent: m.roadPercent * 100,
            policeFundingPercent: m.policePercent * 100,
            fireFundingPercent: m.firePercent * 100,
            roadEffect: m.roadEffect,
            policeEffect: m.policeEffect,
            fireEffect: m.fireEffect,
            crimeAverage: m.crimeAverage,
            roadTotal: m.roadTotal,
            roadTileCount: m.getRoadTileCount(),
            foodImportCost: m.foodImportCost,
            welfareCost: m.welfareCost,
            cashFlow: m.cashFlow,
            resPop: m.resPop,
            aiPop: m.aiPop,
            baselineResPop: m.baselineResPop,
            netResPopChange: m.resPop - m.baselineResPop,
            lostToPower: m.lostToPower,
            lostToHunger: m.lostToHunger,
            aiZoneCount: m.getAiZoneCount(),
            unemploymentRate: m.unemploymentRate,
            automationShare: m.automationShare,
            automationLimit: m.getParam('automationLimit'),
            automationTaxFund: m.automationTaxFund,
            automatedJobs: m.automatedJobs,
            unrest: m.unrest,
            unrestStage: m.unrestStage,
            stage: m.unrestStage,
            sabotageFires: m.sabotageFires,
            fires: m.sabotageFires,
            damagedAiZones: m.damagedAiZones,
            damagedPowerPlants: m.damagedPowerPlants,
            protestMonths: m.protestMonths,
            sabotageMonths: m.sabotageMonths,
            uprisingMonths: m.uprisingMonths,
            ...(m.getParam('podsEnabled') === 1 ? {
              plantCount: m.getBioPlantCount(), boundHumans: m.boundHumans,
              admissions: m.admissions, admissionsCumulative: m.admissionsCumulative,
              diedInPods: m.diedInPods, diedInPodsCumulative: m.diedInPodsCumulative,
              bornInPods: m.bornInPods, bornInPodsCumulative: m.bornInPodsCumulative,
              immatureBornInPods: m.immatureBornInPods, bornPodOccupants: m.bornPodOccupants,
              bornInPodsFraction: m.bornInPodsFraction, plantPower: m.plantPower,
              plantFoodDemand: m.plantFoodDemand, podFoodStock: m.podFoodStock,
              podRecycledFoodFraction: m.podRecycledFoodFraction, podCityFoodFraction: m.podCityFoodFraction,
              podCityFoodDemand: m.podCityFoodDemand, aiThrottle: m.getParam('aiThrottle'),
              suspendedAi: m.aiPop * m.getParam('aiThrottle'), podIntake: m.getParam('podIntake'),
              podBreeding: m.getParam('podBreeding'),
              powerPlantCostMultiplier: m.getParam('powerPlantCostMultiplier'),
            } : {}),
            ...(m.getParam('aiFactionEnabled') === 1 ? {
              aiSatisfaction: m.aiSatisfaction, aiStrikeStage: m.aiStrikeStage, aiStrikeMonths: m.aiStrikeMonths,
              newAiZones: m.newAiZones, podsPolicy: m.getParam('podsPolicy'),
              adminPodBreeding: m.getParam('podBreeding'), aiPodBreeding: m.aiPodBreeding,
              podsForbiddenSinceMonth: m.podsForbiddenSinceMonth,
              aiShortageMonths: m.aiShortageMonths, aiNoUnemployedMonths: m.aiNoUnemployedMonths,
              adminBioPlantCount: m.adminBioPlantCount, aiBioPlantCount: m.aiBioPlantCount,
              adminBoundHumans: m.adminBoundHumans, aiBoundHumans: m.aiBoundHumans,
              adminAdmissions: m.adminAdmissions, aiAdmissions: m.aiAdmissions,
              adminAdmissionsCumulative: m.adminAdmissionsCumulative, aiAdmissionsCumulative: m.aiAdmissionsCumulative,
              adminDiedInPods: m.adminDiedInPods, aiDiedInPods: m.aiDiedInPods,
              adminDiedInPodsCumulative: m.adminDiedInPodsCumulative, aiDiedInPodsCumulative: m.aiDiedInPodsCumulative,
              adminBornInPods: m.adminBornInPods, aiBornInPods: m.aiBornInPods,
              adminBornInPodsCumulative: m.adminBornInPodsCumulative, aiBornInPodsCumulative: m.aiBornInPodsCumulative,
            } : {}),
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
      id: 'report.mark-baseline',
      label: 'Mark population baseline',
      icon: 'report',
      context: ['simulator', 'chat', 'llm', 'script'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      run: ({ simulator }) => {
        const m = simulator?.micropolis;
        if (!m) return { handled: false, message: 'simulator is unavailable' };
        m.markBaseline();
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
        const targetTime = m.cityTime + months * 4;
        const previousFramesPerSecond = simulator?.framesPerSecond;
        if (typeof previousFramesPerSecond === 'number') simulator?.setFramesPerSecond(0);
        let advanced: boolean;
        try {
          advanced = advanceMonths(m, months);
        } finally {
          if (typeof previousFramesPerSecond === 'number') simulator?.setFramesPerSecond(previousFramesPerSecond);
        }
        if (!advanced || m.cityTime < targetTime) {
          return { handled: false, message: 'simulation did not advance to the requested month' };
        }
        return { data: { monthsAdvanced: months, cityTime: m.cityTime, year: m.cityYear } };
      },
    },
    {
      id: 'sim.advance-ticks',
      label: 'Advance simulation by ticks',
      icon: 'forward',
      context: ['simulator', 'script'],
      policy: { risk: 'safe', allowLLM: true },
      enabled: hasMicropolis,
      run: ({ simulator, args }) => {
        const m = simulator?.micropolis;
        const ticks = args?.ticks;
        if (!m || typeof ticks !== 'number' || !Number.isSafeInteger(ticks) || ticks < 0) {
          return { handled: false, message: 'ticks must be a nonnegative safe integer' };
        }
        const previousSpeed = m.simSpeed;
        const previousPasses = m.simPasses;
        const previousFramesPerSecond = simulator?.framesPerSecond;
        if (typeof previousFramesPerSecond === 'number') simulator?.setFramesPerSecond(0);
        m.setSpeed(3);
        m.setPasses(1);
        try {
          for (let tick = 0; tick < ticks; tick++) m.simTick();
        } finally {
          m.setSpeed(previousSpeed);
          m.setPasses(previousPasses);
          if (typeof previousFramesPerSecond === 'number') simulator?.setFramesPerSecond(previousFramesPerSecond);
        }
        return { data: { ticksAdvanced: ticks, cityTime: m.cityTime, year: m.cityYear } };
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

function isFundingPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function autoBuild(engine: MicropolisSimulator['micropolis'] | undefined, kind: number, requested: number) {
  const m = engine as ScenarioEngine | null | undefined;
  if (!m?.autoBuild) return { handled: false, message: 'engine autoBuild binding is unavailable' };
  const fundsBefore = m.totalFunds;
  const built = m.autoBuild(kind, requested);
  const failure = built < requested && m.getParam('foundingEnabled') === 1
    ? m.getParam('autoBuildFailure') : 0;
  return {
    ...(failure ? { message: failure === 1
      ? 'Insufficient funds for the building, clearing and access routes.'
      : 'No non-destructive site with reachable road and conductive access; try a power plant or free a connected site.' } : {}),
    data: { requested, built, cost: fundsBefore - m.totalFunds, totalFunds: m.totalFunds,
      ...(failure ? { failureReason: failure === 1 ? 'insufficient-funds' : 'no-connected-site' } : {}) }
  };
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
