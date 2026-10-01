"use strict";
// Targeted control-state, comparison-definition and input-coalescing checks.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../dist/race-engine.js'),miami=require('./data/miami-control.json'),austin=require('../dist/data/race-austin.json'),{fixture,inputs}=require('./race_fixtures.cjs');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`),at=t=>Date.parse('2025-05-04T20:00:00Z')+t*1000,iso=t=>new Date(at(t)).toISOString();
const ms=E.snapshot(miami,Date.parse('2025-05-04T21:05:00Z'));
assert.equal(ms.restartDiagnostics.length,3);assert.ok(ms.restartDiagnostics.every(d=>d.kind==='VSC'&&d.elapsedSeconds===15&&d.status==='GREEN_INFERRED'));
assert.equal(ms.restartDiagnostics[0].date,'2025-05-04T20:09:10.000Z');
assert.equal(Math.min(...miami.laps.filter(l=>Number.isFinite(E.end(l))).map(l=>l.lap_number)),25);
assert.equal(ms.completedLaps,miami.laps.filter(l=>E.end(l)<=ms.cutoff).length);
for(const year of [2023,2024,2025,2026]){
  const date=`${year}-05-04T20:00:00Z`,t=Date.parse(date),records=[{date,message:'VIRTUAL SAFETY CAR ENDING',lap_number:3}];
  assert.equal(E.controlAt(E.withRestartEstimates(records,[],t+14999),t+14999).status,'VSC_ENDING');
  assert.equal(E.controlAt(E.withRestartEstimates(records,[],t+15000),t+15000).status,'GREEN_INFERRED');
}
const sc=[{date:iso(0),message:'SAFETY CAR IN THIS LAP',lap_number:3}],distant={driver_number:44,lap_number:25,date_start:iso(2000),lap_duration:80};
const failed=E.withRestartEstimates(sc,[distant],at(2200));
assert.equal(E.controlAt(failed,at(2200)).status,'RESTART_UNCONFIRMED');assert.ok(!failed.some(r=>r.inferredRestart));
assert.equal(failed.find(r=>r.restartUnconfirmed).elapsedSeconds,300);
const skipped={...distant,lap_number:6,date_start:iso(60),lap_duration:80};assert.ok(!E.withRestartEstimates(sc,[skipped],at(400)).some(r=>r.inferredRestart));
const valid={...skipped,lap_number:4};assert.equal(E.controlAt(E.withRestartEstimates(sc,[valid],at(140)),at(140)).status,'GREEN_INFERRED');
const red=[{date:iso(0),message:'RACE RESUMED',lap_number:3}];assert.equal(E.withRestartEstimates(red,[distant],at(2200)).find(r=>r.restartUnconfirmed).elapsedSeconds,600);
const local=[{date:iso(0),scope:'Sector',sector:2,message:'VIRTUAL SAFETY CAR ENDING'}];assert.ok(!E.withRestartEstimates(local,[],at(100)).some(r=>r.inferredRestart));
const interrupted=[{date:iso(0),message:'VIRTUAL SAFETY CAR ENDING'},{date:iso(10),scope:'Track',flag:'RED'}];assert.equal(E.controlAt(E.withRestartEstimates(interrupted,[],at(40)),at(40)).status,'RED');
const restored=[...sc,{date:iso(400),scope:'Track',flag:'GREEN'}];assert.equal(E.controlAt(E.withRestartEstimates(restored,[],at(500)),at(500)).status,'GREEN');
assert.deepEqual(E.withRestartEstimates([...sc,{date:iso(500),flag:'GREEN',scope:'Track'}],[],at(400)),E.withRestartEstimates(sc,[],at(400)));
// Unknown control must not silently enter a fit, including an explicit GREEN
// scenario: that assumption is for the future, not historical lap classification.
const f=fixture(),unknown=E.snapshot({...f.data,raceControl:[]},f.cutoff);
assert.ok(unknown.rows.every(r=>r.models.length===0));assert.ok(unknown.rows.some(r=>r.diagnostics.some(d=>d.unknownControlExcluded>0)));
assert.equal(E.evaluate(unknown,4,81,{...inputs,condition:'GREEN'}).reason,'insufficient_pace_age_data');
const heldData={...f.data,raceControl:[{date:f.data.laps[0].date_start,message:'SAFETY CAR IN THIS LAP',lap_number:0}]};
// Missing early lap boundaries exceed the cap; later observed laps stay excluded.
heldData.laps=heldData.laps.filter(l=>l.lap_number>=7);const held=E.snapshot(heldData,f.cutoff);assert.ok(held.rows.every(r=>r.models.length===0));assert.ok(held.rows.some(r=>r.diagnostics.some(d=>d.restartUnconfirmedExcluded>0)));
const s=E.snapshot(austin,austin.cutoff),i={...inputs,compoundA:'MEDIUM',compoundB:'HARD',warmupA:.6,warmupB:.6,maxExtrapolation:5};
const evalAt=(horizon,delay=3,extra={})=>E.evaluate(s,1,44,{...i,horizon,delay,...extra});
for(const [h,delta] of [[12,-.1892],[14,0],[15,.0946]]){
  const r=evalAt(h),b=r.signBoundaries[0],c=r.comparisons[0];assert.equal(b.zeroHorizon,14);assert.equal(b.distance,14-h);close(b.algebraicDelta,delta);close(c.delta,delta);assert.equal(c.parameterCancellation,h===14);
}
assert.equal(evalAt(12,1).comparisons[0].parameterCancellation,true);
assert.equal(evalAt(12,3,{trafficA:1}).signBoundaries.length,0);assert.equal(evalAt(12,3,{condition:'SC'}).signBoundaries.length,0);
assert.equal(evalAt(25).signBoundaries[0].forecastAvailable,false);
// Pure HTML generation in English, no browser interaction.
const html=fs.readFileSync(require.resolve('../dist/race-replay.js'),'utf8'),elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:''});return elements.get(id);};
const ctx=vm.createContext({RaceEngine:E,state:{selectedMode:'replay',selectedA:1,selectedB:44},sessionTitle:()=>"Austin · Race",shortName:String,esc:String,signed:(v,d=2)=>Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(d)}`:'—',tr:en=>en,$:el,snap:s,result:evalAt(14),setTimeout});
vm.runInContext(html.slice(0,html.indexOf('$("race-load").addEventListener')),ctx);
vm.runInContext('renderRaceResults(snap,result)',ctx);const out=[...elements.values()].map(e=>e.innerHTML).join('');assert.match(out,/Regression-parameter contribution cancels/);assert.match(out,/paired parameter-only/);assert.doesNotMatch(out,/undefined|NaN|[가-힣]/);
ctx.snap=ms;assert.match(vm.runInContext('raceRestartDetails(snap)',ctx),/15.0/);
// Deterministic fake clock: multiple inputs coalesce; commit/export flushes.
const app=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),tasks=new Map();let next=0,renders=0,legacy=0;
const timerCtx=vm.createContext({clearTimeout:id=>tasks.delete(id),setTimeout:(fn,ms)=>{assert.equal(ms,200);tasks.set(++next,fn);return next;},state:{sessionContext:{}},syncStrategyControls(){},buildPaceRows(){legacy++;},renderStrategyAnalysis(){legacy++;},renderRaceReplay(){renders++;}});
vm.runInContext(app.slice(app.indexOf('let strategyInputTimer='),app.indexOf('["strategy-horizon", "strategy-delay", "strategy-warmup", "strategy-fuel-gain", "strategy-pit-loss", "strategy-sc-factor", "strategy-vsc-factor"].forEach')),timerCtx);
vm.runInContext('scheduleStrategyInputUpdate(true);scheduleStrategyInputUpdate();scheduleStrategyInputUpdate()',timerCtx);assert.equal(tasks.size,1);assert.equal(renders,0);
const callback=[...tasks.values()][0];callback();assert.equal(renders,1);assert.equal(legacy,1);assert.equal(tasks.size,0);
vm.runInContext('scheduleStrategyInputUpdate();flushPendingStrategyInputUpdate();flushPendingStrategyInputUpdate()',timerCtx);assert.equal(renders,2);assert.equal(tasks.size,0);
let flushes=0;ctx.flushPendingStrategyInputUpdate=()=>flushes++;ctx.state.mode='demo';vm.runInContext('raceExportPayload()',ctx);assert.equal(flushes,1);
console.log(JSON.stringify({checks:'passed',miamiVscElapsedSeconds:ms.restartDiagnostics.map(d=>d.elapsedSeconds),miamiFirstAvailableLap:25,unknownFitModels:unknown.rows.reduce((n,r)=>n+r.models.length,0),debounceRenders:renders,intervalAtBoundary:evalAt(14).comparisons[0].fitHalfWidth},null,2));
