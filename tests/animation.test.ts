import {it,expect} from 'vitest';
import {displayTime,occupiedColor} from '../src/components/animation';
it('freezes a paused display and bounds prediction to one snapshot interval',()=>{
 expect(displayTime(10,1000,5,false)).toBe(10);
 expect(displayTime(10,50,5,true)).toBe(10.25);
 expect(displayTime(10,500,5,true)).toBe(10.5);
});
it('lights orange for every occupied car and shows no occupied light when empty',()=>{
 expect(occupiedColor(1)).toBe('#ff9f43');expect(occupiedColor(12)).toBe('#ff9f43');expect(occupiedColor(0)).toBe('#44566b');
});
