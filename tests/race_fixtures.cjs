"use strict";
// Synthetic implementation fixture, never displayed as a historical race.
function fixture(){
  const start=Date.parse("2023-07-09T14:00:00Z"),iso=t=>new Date(t).toISOString(),cutoff=start+1195000;
  const drivers=[4,81,1].map((driver,i)=>({driver_number:driver,name_acronym:["NOR","PIA","VER"][i]}));
  const laps=drivers.flatMap(({driver_number:driver})=>Array.from({length:20},(_,i)=>({driver_number:driver,lap_number:i+1,date_start:iso(start+i*100000),lap_duration:90+i*.1+(driver===81?.2:0),is_pit_out_lap:false})));
  const stints=drivers.map(({driver_number})=>({driver_number,stint_number:1,compound:"MEDIUM",lap_start:1,lap_end:20,tyre_age_at_start:0}));
  const positions=drivers.map(({driver_number},i)=>({driver_number,position:i+1,date:iso(start+1000)}));
  const intervals=drivers.flatMap(({driver_number},i)=>[...Array.from({length:20},(_,j)=>({driver_number,date:iso(start+j*100000+80000),interval:i?3:null,gap_to_leader:i?i*3:null})),{driver_number,date:iso(cutoff-1000),interval:i?3:null,gap_to_leader:i?i*3:null}]);
  return {cutoff,data:{drivers,laps,stints,positions,intervals,pits:[],weather:[],raceControl:[{date:iso(start),flag:"GREEN",scope:"Track",message:"GREEN FLAG"}]}};
}
const inputs={horizon:12,delay:3,warmup:.6,fuelGain:.035,pitLoss:22,scFactor:.6,vscFactor:.75,compoundA:"MEDIUM",compoundB:"MEDIUM",condition:"observed",neutralLaps:2,paceRange:.3,pitRange:2,trafficA:0,trafficB:0,trafficLaps:1};
module.exports={fixture,inputs};
