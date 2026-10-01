"use strict";
const assert=require("node:assert/strict"),E=require("../dist/race-engine.js"),{fixture,inputs}=require("./race_fixtures.cjs");
const {data,cutoff}=fixture(),s=E.snapshot(data,cutoff,inputs.fuelGain),r=E.evaluate(s,4,81,inputs);
assert.equal(s.control.status,"GREEN");assert.equal(s.rows.length,3);assert.equal(s.rows[0].lastLap,12);assert.equal(s.rows[0].age,12);
assert.equal(s.rows[0].gap,0);assert.equal(s.rows[0].pace.n,11);assert.equal(r.reason,null);assert.equal(r.scenarios.length,3);assert.ok(r.rejoin);
assert.ok(Math.abs(s.rows[0].pace.slope-.135)<1e-10);
const shifted=structuredClone(s);shifted.rows[1].gapDate=new Date(E.time(s.rows[1].gapDate)-1000).toISOString();assert.equal(E.evaluate(shifted,4,81,inputs).reason,null);assert.equal(E.evaluate(shifted,4,81,inputs).rejoin.among,3);
shifted.rows[1].gapDate=new Date(E.time(s.rows[1].gapDate)-6000).toISOString();assert.equal(E.evaluate(shifted,4,81,inputs).reason,"asynchronous_gaps");
// Actual future records must not affect model selection, cleaning, age or control.
const future=structuredClone(data);
future.laps.push({driver_number:4,lap_number:99,date_start:new Date(cutoff+100000).toISOString(),lap_duration:1});
future.stints[0].lap_end=999;future.stints.push({driver_number:4,stint_number:5,lap_start:99,lap_end:999,tyre_age_at_start:0,compound:"SOFT"});
future.raceControl.push({date:new Date(cutoff+1000).toISOString(),scope:"Track",message:"SAFETY CAR DEPLOYED"});
future.positions.push({driver_number:4,position:20,date:new Date(cutoff+1000).toISOString()});
assert.deepEqual(E.snapshot(future,cutoff,inputs.fuelGain),s);
// Excluded laps still age tyres, and missing age is not zero.
const missing=structuredClone(data);missing.stints[0].tyre_age_at_start=null;
assert.equal(E.snapshot(missing,cutoff).rows[0].age,null);assert.equal(E.snapshot(missing,cutoff).rows[0].pace,null);
const excluded=structuredClone(data);excluded.laps.find(l=>l.driver_number===4&&l.lap_number===12).is_pit_in_lap=true;
assert.equal(E.snapshot(excluded,cutoff).rows[0].age,12);assert.equal(E.snapshot(excluded,cutoff).rows[0].pace.n,10);
const lapped=structuredClone(data);lapped.intervals.filter(v=>v.driver_number===81).forEach(v=>v.gap_to_leader="+1 LAP");
assert.equal(E.evaluate(E.snapshot(lapped,cutoff),4,81,inputs).reason,"missing_stale_or_lapped_gap");
const stale=structuredClone(data);stale.intervals=stale.intervals.filter(v=>v.driver_number!==81||E.time(v.date)<cutoff-20000);
assert.equal(E.evaluate(E.snapshot(stale,cutoff),4,81,inputs).reason,"missing_stale_or_lapped_gap");
// Global restart only. Ending notices and pit/sector GREEN are not release events.
const iso=i=>new Date(cutoff+i*1000).toISOString();
const controls=[{date:iso(0),scope:"Track",message:"SAFETY CAR DEPLOYED"},{date:iso(1),scope:"Track",message:"SAFETY CAR IN THIS LAP"},{date:iso(2),scope:"Sector",flag:"GREEN",message:"GREEN FLAG"},{date:iso(3),message:"GREEN LIGHT - PIT EXIT OPEN"}];
assert.equal(E.controlAt(controls,cutoff+4000).status,"SC_ENDING");
controls.push({date:iso(5),scope:"Track",flag:"GREEN",message:"GREEN FLAG"});assert.equal(E.controlAt(controls,cutoff+5000).status,"GREEN");
assert.equal(E.controlAt([{date:iso(0),message:"VIRTUAL SAFETY CAR DEPLOYED"},{date:iso(1),message:"VSC ENDING"}],cutoff+999000).status,"VSC_ENDING");
// Identical models: pit loss appears after A-only stop, cancels after BOTH stops.
const a=structuredClone(s.rows[0]),b=structuredClone(s.rows[0]);b.driver=81;b.gap=3;
a.pace.slope=b.pace.slope=0;a.models[0].slope=b.models[0].slope=0;
const p={...inputs,warmup:0,fuelGain:0,paceRange:0,pitRange:0};
const identical=E.simulatePair(a,b,p,0,3,"GREEN",0);
assert.equal(identical.points[1].gap,19);assert.equal(identical.afterBoth,-3);assert.equal(identical.finishGap,-3);
const sc=E.evaluate(s,4,81,{...inputs,condition:"SC"});assert.equal(sc.rejoin,null);assert.equal(sc.rankHold,true);assert.equal(sc.savings.SC,13.2);
assert.equal(E.evaluate(s,4,81,{...inputs,compoundA:"SOFT"}).reason,"new_compound_has_no_prior_fit");
assert.ok(r.scenarios.every(v=>v.rangeAtBoth[0]<=v.afterBoth&&v.rangeAtBoth[1]>=v.afterBoth));
console.log(JSON.stringify({result:"historical race engine checks passed",cutoff:s.cutoffISO,fit:s.rows[0].pace.n,age:s.rows[0].age,scenarios:r.scenarios.map(v=>({id:v.id,afterBoth:v.afterBoth,range:v.rangeAtBoth})),rejoin:r.rejoin},null,2));
