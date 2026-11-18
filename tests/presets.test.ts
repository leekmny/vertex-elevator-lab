import {describe,it,expect} from 'vitest';
import {demoExperiment,randomizeExperiment} from '../src/sim/presets';
import {validateConfig} from '../src/sim/config';
import {Simulation} from '../src/sim/engine';
describe('simple varied traffic presets',()=>{
 it('opens with passengers ready to animate without an empty waiting period',()=>{
  const {config,algorithm}=demoExperiment();
  expect(config.floors).toBe(10);expect(config.cars).toBe(3);
  expect(new Simulation(config,algorithm).advanceTo(10).metrics.generated).toBeGreaterThan(0);
 });
 it('reproduces the same random experiment from its seed',()=>{
  expect(randomizeExperiment(12345)).toEqual(randomizeExperiment(12345));
 });
 it('varies traffic, building, fleet, policy and algorithm without invalid service paths',()=>{
  const cases=Array.from({length:80},(_,i)=>randomizeExperiment(i));
  for(const {config,algorithm} of cases){expect(()=>validateConfig(config)).not.toThrow();expect(()=>new Simulation(config,algorithm)).not.toThrow();}
  for(const values of [cases.map(p=>p.config.floors),cases.map(p=>p.config.cars),cases.map(p=>p.config.scenario),cases.map(p=>p.algorithm),cases.map(p=>p.config.policy)])expect(new Set<unknown>(values).size).toBeGreaterThan(3);
 });
 it.each([0,17,2026])('actually transports conserved passengers in random experiment %s',seed=>{
  const {config,algorithm}=randomizeExperiment(seed);const s=new Simulation(config,algorithm).run();
  expect(s.metrics.completed).toBeGreaterThan(0);expect(s.metrics.generated).toBe(s.metrics.waiting+s.metrics.onboard+s.metrics.completed);
 });
});
