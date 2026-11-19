import { readFileSync } from 'node:fs';
import { generateDemand } from '../../src/sim/demand';
import { Simulation } from '../../src/sim/engine';
import { manualCalls } from '../../src/sim/manual';
import { runExperiment, type Progress } from '../../src/research/runner';
import type { AlgorithmId, Config, Demand, ExperimentPlan, Snapshot } from '../../src/sim/types';

export type Command =
  | { type: 'snapshot' | 'step' | 'run' }
  | { type: 'advance' | 'seek'; time: number }
  | { type: 'failure'; id: number }
  | { type: 'callFloors'; floors: number[]; count?: number }
  | { type: 'inject'; records: Demand[] };

export interface Request {
  config: Config;
  algorithms: AlgorithmId[];
  demand?: Demand[];
  commands: Command[];
}

export interface ResearchRequest {
  config: Config;
  plan: ExperimentPlan;
  cancelAfter?: number;
}

function execute(request: Request) {
  const { config, algorithms, commands, demand = generateDemand(request.config) } = request;
  const initialize = () => algorithms.map((id) => new Simulation(config, id, demand));
  let simulations = initialize(),
    batch = 0;
  const traces: Snapshot[][] = [];
  const errors: Array<string | null> = [];
  for (const command of commands) {
    try {
      switch (command.type) {
        case 'snapshot':
          break;
        case 'advance':
          simulations.forEach((simulation) => simulation.advanceTo(command.time));
          break;
        case 'step':
          if (simulations.length) {
            const { time } = simulations[0].step();
            simulations.slice(1).forEach((simulation) => simulation.advanceTo(time));
          }
          break;
        case 'run':
          simulations.forEach((simulation) => simulation.run());
          break;
        case 'failure':
          simulations.forEach((simulation) => simulation.failCar(command.id));
          break;
        case 'callFloors':
          if (simulations.length) {
            const time = Math.max(...simulations.map((simulation) => simulation.time));
            simulations.forEach((simulation) => simulation.advanceTo(time));
            const records = manualCalls(config, time, command.floors, command.count ?? 1, batch++);
            simulations.forEach((simulation) => simulation.injectPassengers(records));
          }
          break;
        case 'inject':
          simulations.forEach((simulation) => simulation.injectPassengers(command.records));
          break;
        case 'seek':
          simulations = initialize();
          simulations.forEach((simulation) => simulation.advanceTo(command.time));
          break;
      }
      errors.push(null);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    traces.push(simulations.map((simulation) => simulation.snapshot()));
  }
  return { traces, errors };
}

const input = readFileSync(process.argv[2] ?? 0, 'utf8');
const request = JSON.parse(input) as Request | ResearchRequest;
async function executeResearch(request: ResearchRequest) {
  const progress: Progress[] = [];
  const {
    createdAt: _createdAt,
    elapsedMs: _elapsedMs,
    ...result
  } = await runExperiment(request.config, request.plan, {
    shouldCancel: () => progress.length >= (request.cancelAfter ?? Infinity),
    onProgress: (trial) => progress.push(trial),
  });
  return { progress, result };
}
const result = 'plan' in request ? await executeResearch(request) : execute(request);
process.stdout.write(JSON.stringify(result) + '\n');
