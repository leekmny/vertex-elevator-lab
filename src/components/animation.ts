export function displayTime(time:number,elapsedMs:number,speed:number,running:boolean){return time+(running?Math.min(Math.max(0,elapsedMs)/1000,.1)*speed:0);}
export function occupiedColor(people:number){return people>0?'#ff9f43':'#44566b';}
