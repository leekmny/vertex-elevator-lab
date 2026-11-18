import { Simulation } from '../sim/engine';
import { generateDemand } from '../sim/demand';
import {manualCalls} from '../sim/manual';
import type { AlgorithmId, Config } from '../sim/types';
let simulations: Simulation[] = [];
let callBatch=0;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      const config: Config = data.config;
      callBatch=0;
      const demand = generateDemand(config);
      simulations = data.algorithms.map((id: AlgorithmId) => new Simulation(config, id, demand));
    }
    if (data.type === 'advance') simulations.forEach((s) => s.advanceTo(data.time));
    if(data.type==='callFloors'&&simulations.length){
      const now=Math.max(...simulations.map(s=>s.time));
      simulations.forEach(s=>s.advanceTo(now));
      const records=manualCalls(simulations[0].config,now,data.floors,data.count??1,callBatch++);
      simulations.forEach(s=>s.injectPassengers(records));
    }
    if (data.type === 'step' && simulations.length) {
      const snap = simulations[0].step();
      simulations.slice(1).forEach((s) => s.advanceTo(snap.time));
    }
    if (data.type === 'failure') simulations.forEach((s) => s.failCar(data.id));
    if (data.type === 'seek') {
      const demand = generateDemand(data.config);
      simulations = data.algorithms.map(
        (id: AlgorithmId) => new Simulation(data.config, id, demand),
      );
      simulations.forEach((s) => s.advanceTo(data.time));
    }
    self.postMessage({ type: 'snapshots', snapshots: simulations.map((s) => s.snapshot()) });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
