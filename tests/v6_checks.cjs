"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../dist/race-engine.js'),austin=require('../dist/data/race-austin.json'),vegas=require('../dist/data/race-demo.json'),melbourne=require('./data/melbourne-control.json');
const inputs={...require('./race_fixtures.cjs').inputs,compoundA:'MEDIUM',compoundB:'HARD',warmupA:.6,warmupB:.6,maxExtrapolation:5};
const s=E.snapshot(austin,austin.cutoff),r=E.evaluate(s,1,44,inputs);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
near(r.comparisons[0].delta,-6*r.b.pace.slope);near(r.comparisons[1].delta,21*r.a.pace.slope);
assert.ok(r.replacementEvidence.every(e=>e.sameAsCurrent&&!e.independentReplacementValidation));
for(const f of r.fuelSensitivity){
  const refit=E.snapshot(austin,austin.cutoff,f.fuel),ar=refit.rows.find(r=>r.driver===1),br=refit.rows.find(r=>r.driver===44);
  near(f.slopeA,ar.pace.slope);near(f.slopeB,br.pace.slope);
  near(f.comparisons[0].algebraicDelta,-6*br.pace.slope);near(f.comparisons[1].algebraicDelta,21*ar.pace.slope);
}
assert.equal(r.fuelSensitivity[0].comparisons[0].supported,false);
assert.equal(r.fuelSensitivity.at(-1).comparisons[0].supported,true);
const before=JSON.stringify(r.scenarios[0].weights);E.contrastWeights(r.scenarios[0].weights,r.scenarios[2].weights);assert.equal(JSON.stringify(r.scenarios[0].weights),before);
assert.ok(r.scanSupport.missing.includes(6));assert.equal(r.scanSupport.positiveSlopeShortHorizon,true);
const wider=E.evaluate(E.snapshot(austin,austin.cutoff,.035,10),1,44,{...inputs,maxExtrapolation:10});
assert.ok(wider.scanSupport.missing.length<r.scanSupport.missing.length);
const vs=E.snapshot(vegas,vegas.cutoff),vr=E.evaluate(vs,1,16,{...inputs,compoundA:'HARD',compoundB:'HARD'});
assert.ok(vr.scenarios.every(x=>x.unavailable));
assert.equal(E.supported({...r.a.pace,slope:-.1},0,20),false);
const cutoff=E.end(melbourne.laps.find(l=>l.driver_number===1&&l.lap_number===49)),ms=E.snapshot(melbourne,cutoff),ver=ms.rows.find(r=>r.driver===1);
assert.equal(ms.control.status,'GREEN_INFERRED');assert.equal(ver.pace.n,37);
assert.ok(ver.pace.points.some(p=>p.lap>10&&p.lap<18));assert.ok(ver.pace.points.some(p=>p.lap>20));
for(const snap of [s,vs,ms])for(const row of snap.rows)for(const m of row.models)assert.equal(m.controlRecorded+m.controlInferred+m.controlUnknown,m.n);
const at=t=>Date.parse('2023-04-02T05:00:00Z')+t*1000,iso=t=>new Date(at(t)).toISOString();
const vsc=[{date:iso(0),message:'VIRTUAL SAFETY CAR DEPLOYED'},{date:iso(20),message:'VIRTUAL SAFETY CAR ENDING'}];
assert.equal(E.controlAt(E.withRestartEstimates(vsc,[],at(34)),at(34)).status,'VSC_ENDING');
assert.equal(E.controlAt(E.withRestartEstimates(vsc,[],at(35)),at(35)).status,'GREEN_INFERRED');
const interruption=[...vsc,{date:iso(30),message:'SAFETY CAR DEPLOYED'}];
assert.equal(E.controlAt(E.withRestartEstimates(interruption,[],at(40)),at(40)).status,'SC');
const red=[{date:iso(0),scope:'Track',flag:'RED'},{date:iso(20),lap_number:9,message:'RACE WILL RESUME AT 15:33 - STANDING START PROCEDURE'}],lap={driver_number:1,lap_number:10,date_start:iso(30),lap_duration:90};
assert.equal(E.controlAt(E.withRestartEstimates(red,[lap],at(119)),at(119)).status,'RED');
assert.equal(E.controlAt(E.withRestartEstimates(red,[lap],at(120)),at(120)).status,'GREEN_INFERRED');
const future={...melbourne,raceControl:[...melbourne.raceControl,{date:new Date(cutoff+1000).toISOString(),flag:'RED',scope:'Track'}]};
assert.deepEqual(E.snapshot(future,cutoff),ms);
// Render the HTML-producing functions in a VM, without launching a browser.
const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:''});return elements.get(id);};
const source=fs.readFileSync(require.resolve('../dist/race-replay.js'),'utf8');
const context=vm.createContext({RaceEngine:E,state:{selectedMode:'replay',selectedA:1,selectedB:44},sessionTitle:()=>"Austin · Race",shortName:String,esc:String,signed:(v,d=2)=>Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(d)}`:'—',tr:(en,ko)=>ko,$:element,snap:s,result:r,setTimeout});
vm.runInContext(source.slice(0,source.indexOf('$("race-load").addEventListener')),context);
vm.runInContext('renderRaceResults(snap,result)',context);
assert.match([...elements.values()].map(e=>e.innerHTML).join(''),/연료 가정 변화/);assert.match([...elements.values()].map(e=>e.innerHTML).join(''),/현재 stint 회귀선/);assert.doesNotMatch([...elements.values()].map(e=>e.innerHTML).join(''),/NaN|undefined/);
context.snap=vs;context.result=vr;vm.runInContext('renderRaceResults(snap,result)',context);assert.match([...elements.values()].map(e=>e.innerHTML).join(''),/결론: 예측 보류/);assert.match([...elements.values()].map(e=>e.innerHTML).join(''),/원인은 분리할 수 없습니다/);
context.result={...vr,reason:'asynchronous_gaps'};vm.runInContext('renderRaceResults(snap,result)',context);assert.match([...elements.values()].map(e=>e.innerHTML).join(''),/관측시각 차이가 5초/);
context.tr=en=>en;context.snap=s;context.result=r;vm.runInContext('renderRaceResults(snap,result)',context);assert.match([...elements.values()].map(e=>e.innerHTML).join(''),/Fuel assumption versus fit uncertainty/);assert.doesNotMatch([...elements.values()].map(e=>e.innerHTML).join(''),/NaN|undefined/);
// Queue holds until body consumption, handles retry and releases on failure.
(async()=>{
  context.raw=austin;context.inputs=inputs;context.state.selectedA=1;context.state.selectedB=44;
  context.laps=austin.laps.filter(l=>l.driver_number===1&&Number.isFinite(E.end(l)));
  element('race-cutoff').options=context.laps.map(l=>({value:String(l.lap_number),textContent:''}));
  vm.runInContext('raceReplay.raw=raw;raceReplay.selectionKey="9213:1:44";scheduleCutoffAvailability(laps,inputs)',context);
  const started=Date.now();while(!/cutoffs support/.test(element('race-availability-status').textContent)){if(Date.now()-started>20000)throw Error('Cutoff availability did not complete');await new Promise(resolve=>setTimeout(resolve,20));}
  assert.match(element('race-cutoff').options.find(o=>o.value==='32').textContent,/READY/);
  const app=fs.readFileSync(require.resolve('../dist/app.js'),'utf8');let active=0,peak=0,count=0,fail=false;
  const ctx=vm.createContext({state:{generation:1},API_REQUEST_GAP_MS:1,Date,Set,AbortController,clearTimeout,setTimeout:(fn,ms)=>setTimeout(fn,ms===15000?ms:Math.min(ms,10)),apiUrl:e=>e,tr:en=>en,
    fetch:async()=>{active++;peak=Math.max(peak,active);const n=++count;if(fail){active--;throw Error('offline');}if(n===1){active--;return{ok:false,status:429,headers:{get:()=>null}};}return{ok:true,json:async()=>{await new Promise(resolve=>setTimeout(resolve,15));active--;return[n];}};}});
  vm.runInContext(app.slice(app.indexOf('let apiRequestGate'),app.indexOf('async function optionalApiFetch')),ctx);
  await vm.runInContext('Promise.all([apiFetch("a"),apiFetch("b"),apiFetch("c")])',ctx);assert.equal(peak,1);assert.equal(count,4);
  fail=true;await assert.rejects(vm.runInContext('apiFetch("bad")',ctx));fail=false;assert.ok(await vm.runInContext('apiFetch("recovered")',ctx));
  console.log(JSON.stringify({checks:'passed',melbourne:{cutoff:ms.cutoffISO,models:ms.rows.filter(r=>r.models.length).length,verFitLaps:ver.pace.n,control:ms.control.status,pitEndpoint:'404; absent, control regression only'},fuel:r.fuelSensitivity,missingOffsets:r.scanSupport.missing,apiPeakConcurrency:peak},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
