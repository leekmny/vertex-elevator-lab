import {defaultConfig} from './config';
import {rng} from './demand';
import {ALGORITHMS} from './algorithms';
import type {AlgorithmId,Config} from './types';
export interface AnimationExperiment {config:Config;algorithm:AlgorithmId;label:string}
export function demoExperiment():AnimationExperiment {
 const config=defaultConfig();Object.assign(config,{floors:10,cars:3,duration:180,rate:18,floorWeights:Array(10).fill(1),floorPopulation:Array(10).fill(50),initialQueues:[2,0,1,0,2,0,1,0,0,2]});
 return {config,algorithm:'eta',label:'여러 층에서 승객들이 엘리베이터를 기다려요'};
}
export function randomizeExperiment(seed:number):AnimationExperiment {
 const random=rng(seed),pick=<T>(items:T[]):T=>items[Math.floor(random()*items.length)];
 const config=defaultConfig(),floors=pick([5,8,10,12,15,20,25,30,40]),cars=pick([1,2,3,4,5,6,8]);
 const traffic=pick([{id:'random',name:'여러 층 사이를 자유롭게 이동해요'},{id:'downpeak',name:'위층 사람들이 로비로 내려와요'},{id:'uppeak',name:'로비에서 여러 층으로 올라가요'},{id:'simultaneous',name:'모든 층에서 한꺼번에 호출해요'},{id:'hotspot',name:'특정 층에 사람들이 몰려요'},{id:'changing',name:'시간이 지나면서 승객 흐름이 바뀌어요'},{id:'interfloor',name:'층 사이 이동이 많아요'},{id:'lobby',name:'로비에서 많은 사람들이 기다려요'}]);
 Object.assign(config,{seed:seed>>>0,floors,cars,duration:180,rate:Math.round((8+random()*6)*Math.sqrt(cars)),congestion:pick([60,100,140,180]),scenario:traffic.id,policy:pick(['shared','shared','parity','zoned','dynamic']),zoneCount:Math.min(cars,pick([2,3])),floorWeights:Array.from({length:floors},()=>.5+Math.round(random()*20)/10),floorPopulation:Array.from({length:floors},()=>pick([25,50,100])),initialQueues:Array.from({length:floors},()=>random()<.3?1+Math.floor(random()*3):0),idle:pick(['lobby','middle','high','predictive'])});
 config.car={...config.car,capacity:pick([6,8,10,12,16]),speed:pick([1.5,2,2.5,3,4])};
 return {config,algorithm:pick(ALGORITHMS.map(a=>a.id)),label:traffic.name};
}
