import {it,expect} from 'vitest';
import {defaultConfig} from '../src/sim/config';
import {manualCalls} from '../src/sim/manual';
it('makes simultaneous reproducible hall demand with disjoint user-call IDs',()=>{
 const c=defaultConfig();const a=manualCalls(c,15,[1,5,9],2,0),b=manualCalls(c,15,[1,5,9],2,1);
 expect(a).toEqual(manualCalls(c,15,[1,5,9],2,0));expect(a).toHaveLength(6);expect(new Set(a.map(p=>p.at))).toEqual(new Set([15]));expect(a.map(p=>p.origin)).toEqual([1,1,5,5,9,9]);expect(a.every(p=>p.id<0&&p.origin!==p.destination)).toBe(true);expect(a.some(p=>b.some(q=>q.id===p.id))).toBe(false);
});
it('rejects nonexistent floor calls rather than dropping or teleporting people',()=>{expect(()=>manualCalls(defaultConfig(),0,[101],2,0)).toThrow();});
