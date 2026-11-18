import {describe,it,expect} from 'vitest';
import {Simulation} from '../src/sim/engine';
import {defaultConfig} from '../src/sim/config';
describe('real simultaneous passenger calls',()=>{
 const setup=()=>{const c=defaultConfig();Object.assign(c,{floors:5,cars:2,rate:0,duration:100,drain:true});c.car.capacity=1;return c;};
 it('introduces actual people at three floors at the same simulation time',()=>{
  const s=new Simulation(setup(),'eta');s.advanceTo(5);
  (s as any).injectPassengers?.([{id:-1,at:5,origin:1,destination:5},{id:-2,at:5,origin:3,destination:1},{id:-3,at:5,origin:5,destination:2}]);
  const now=s.snapshot();expect(now.metrics.generated).toBe(3);expect(now.metrics.waiting).toBe(3);expect(now.passengers.map(p=>p.at)).toEqual([5,5,5]);
  const end=s.run();expect(end.metrics.completed).toBe(3);expect(end.metrics.generated).toBe(end.metrics.waiting+end.metrics.onboard+end.metrics.completed);expect(end.cars.every(c=>c.passengers.length<=1)).toBe(true);
 });
 it('rejects an invalid batch atomically and preserves scheduled IDs',()=>{
  const s=new Simulation(setup(),'eta',[{id:7,at:20,origin:1,destination:3}]);s.advanceTo(5);
  expect(()=>(s as any).injectPassengers([{id:-1,at:5,origin:1,destination:2},{id:7,at:5,origin:2,destination:3}])).toThrow();
  expect(s.snapshot().metrics.generated).toBe(0);
 });
});
