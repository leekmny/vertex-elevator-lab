import type {Config,Demand} from './types';
import {allFloors} from './config';
import {rng} from './demand';
export function manualCalls(config:Config,time:number,floors:number[],count:number,batch:number):Demand[]{
 const fs=allFloors(config),random=rng(config.seed^Math.imul(batch+1,0x45d9f3b));
 if(!Number.isFinite(time)||time<0||!Number.isInteger(count)||count<1||count>20||!Number.isInteger(batch)||batch<0||floors.some(f=>!fs.includes(f)))throw Error('호출할 층이나 인원수가 잘못되었어요.');
 const result:Demand[]=[];
 for(const origin of new Set(floors))for(let i=0;i<count;i++){
  const choices=fs.filter(f=>f!==origin),destination=choices[Math.floor(random()*choices.length)];
  result.push({id:-(batch*10000+result.length+1),at:time,origin,destination});
 }
 return result;
}
