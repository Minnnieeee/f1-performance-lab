"use strict";
// Bounded regressions for the five issues reported against version 7.
const assert=require("node:assert/strict"), fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../dist/app.js"),"utf8");
const elements=new Map();
function element(id) {
  if(!elements.has(id)) elements.set(id,{value:"",style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},closest(){return this;},textContent:"",innerHTML:""});
  return elements.get(id);
}
const ctx=vm.createContext({console,Date,Intl,Math,Map,Set,URL,performance,setTimeout,clearTimeout,document:{getElementById:element,querySelectorAll(){return[];}}});
vm.runInContext(source.slice(0,source.indexOf('document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener')),ctx);
// Load only the pure snapshot and sector/export helpers, no browser bindings.
vm.runInContext(source.slice(source.indexOf("function telemetrySnapshot()"),source.indexOf("function registerWebMcpTools()")),ctx);
const lab=fs.readFileSync(path.join(__dirname,"../dist/lab.js"),"utf8");
vm.runInContext(lab.slice(lab.indexOf("function sectorChecks()"),lab.indexOf("function updateLabDetails()")),ctx);
ctx.frozen=JSON.parse(fs.readFileSync(path.join(__dirname,"../dist/data/demo.json"),"utf8"));
const run=code=>vm.runInContext(code,ctx);
run(`
function fixture(phase,delay=0,endpoints=true,ellipse=false) {
  const times=[];if(endpoints)times.push(0);
  for(let t=phase;t<90;t+=.24) times.push(t);
  if(endpoints)times.push(90);
  return {lap:{driver_number:1,lap_number:1,lap_duration:90+delay,date_start:'2026-01-01T00:00:00Z'},
    locations:times.map(t=>({t:t+delay,x:ellipse?1000*Math.cos(t/90*2*Math.PI):40*t,y:ellipse?700*Math.sin(t/90*2*Math.PI):0})),
    telemetry:times.map(t=>({t:t+delay,speed:144,throttle:80,brake:0,n_gear:5,rpm:10000}))};
}
function compare(phaseA,phaseB,delay=0,endpoints=true,ellipse=false) {
  const da=fixture(phaseA,0,endpoints,ellipse),db=fixture(phaseB,delay,endpoints,ellipse);
  const a=buildLapDistancePath(da),b=buildLapDistancePath(db);projectOntoReference(b,a);
  const points=Array.from({length:1001},(_,i)=>localDeltaAt(a,b,i/1000));
  const valid=points.filter(Number.isFinite);
  return {maxError:Math.max(...valid.map(d=>Math.abs(d+delay))),valid:valid.length,first:points[0],last:points.at(-1),outside:b.quality.outsideReference,
    edgesPreserved:[0,1,da.locations.length-2,da.locations.length-1].every(i=>a.path[i].x===da.locations[i].x&&a.path[i].y===da.locations[i].y&&a.path[i].t===da.locations[i].t)};
}
`);
const boundary=run(`({common:compare(.05,.20),noncommon:compare(.01,.16,0,false),offset:compare(.01,.16,.7,false),curve:compare(.05,.20,0,true,true)})`);
assert.ok(boundary.common.maxError<1e-9);
assert.ok(boundary.noncommon.maxError<1e-9);
assert.equal(boundary.noncommon.first,null);assert.equal(boundary.noncommon.last,null);
assert.ok(boundary.noncommon.outside>0);
assert.ok(boundary.offset.maxError<1e-9);
assert.ok(boundary.curve.maxError<.001,"Polygon interpolation is not exact circle geometry");
assert.equal(boundary.common.edgesPreserved,true);

const missing=run(`(() => {
  const value=normalizeLiveTelemetry({date:'2026-01-01T00:00:00Z',speed:null,brake:null,throttle:' ',n_gear:undefined,rpm:null});
  const zero=telemetryChannels({speed:0,brake:false,throttle:0,n_gear:0,rpm:0});
  const svg=svgPath([{t:0,speed:100},{t:1,speed:null},{t:2,speed:0}],p=>p.speed,{start:0,end:2},360,100);
  const stats=rollingStats([{speed:null,throttle:null,brake:null},{speed:100,throttle:100,brake:0},{speed:0,throttle:0,brake:1}]);
  const empty=rollingStats([{speed:null,throttle:null,brake:null}]);
  const ages=[null,undefined,'',' '].map(age=>tyreAgeForLap({lap_number:3},{lap_start:1,tyre_age_at_start:age}));
  return {value,zero,svg,stats,empty,ages,zeroAge:tyreAgeForLap({lap_number:1},{lap_start:1,tyre_age_at_start:0})};
})()`);
for(const key of ["speed","brake","throttle","n_gear","rpm"]) {assert.equal(missing.value[key],null);assert.equal(missing.zero[key],0);}
assert.equal((missing.svg.match(/M/g)||[]).length,2);assert.ok(!missing.svg.includes("L"));
assert.equal(missing.stats.min,0);assert.equal(missing.stats.full,50);assert.equal(missing.stats.brakes,1);
assert.equal(missing.empty.min,null);assert.equal(missing.empty.full,null);assert.equal(missing.empty.brakes,null);
assert.ok(missing.ages.every(age=>age===null));assert.equal(missing.zeroAge,0);
element("strategy-fuel-gain").value="";assert.equal(run("modelFuelGain()"),.035);
element("strategy-fuel-gain").value="0";assert.equal(run("modelFuelGain()"),0);
element("strategy-horizon").value="3";element("strategy-delay").value="29";
assert.equal(run("strategyInputs().delay"),2);run("syncStrategyControls({commit:true})");assert.equal(element("strategy-delay").value,"2");
const prepare=`
state.mode='replay';state.source='openf1';state.selectedA=1;state.selectedB=2;
state.session={session_key:10,session_name:'Race',session_type:'Race',date_start:'2026-01-01T00:00:00Z'};
state.drivers=[{driver_number:1,name_acronym:'AAA'},{driver_number:2,name_acronym:'BBB'}];
state.sessionContext={stints:[{driver_number:1,stint_number:1,compound:'SOFT',lap_start:1,lap_end:3,tyre_age_at_start:0}],pits:[],weather:[],raceControl:[],intervals:new Map(),intervalAvailability:new Map()};
state.laps=[90,90,90.3].map((time,i)=>({driver_number:1,lap_number:i+1,lap_duration:time,date_start:new Date(Date.parse(state.session.date_start)+i*100000).toISOString()}));
buildPaceRows();
`;
run(prepare);
const fit=run(`(() => {const r=state.paceRows[0],y=[90,90,90.3],p=y.map((_,i)=>predictedPace(r,i)),average=mean(y);return {base:r.basePace,slope:r.degradation,r2:r.r2,usedR2:1-y.reduce((s,v,i)=>s+(v-p[i])**2,0)/y.reduce((s,v)=>s+(v-average)**2,0)};})()`);
assert.ok(Math.abs(fit.base-89.95)<1e-9);assert.ok(Math.abs(fit.slope-.15)<1e-9);assert.ok(Math.abs(fit.r2-.75)<1e-9);assert.ok(Math.abs(fit.usedR2-fit.r2)<1e-9);
run("state.sessionContext.stints[0].tyre_age_at_start=null;buildPaceRows();");
assert.equal(run("state.paceRows[0].basePace"),null);assert.equal(run("state.paceRows[0].currentAge"),null);assert.equal(run("representativePaceRow(1)"),null);
const trend=run(`(() => {
  state.session.session_name='Practice 1';state.session.session_type='Practice';
  state.laps=[[1,0,90],[1,.25,89],[2,.5,91],[2,.75,90]].map(([driver,hours,time],i)=>({driver_number:driver,lap_number:i+1,lap_duration:time,date_start:new Date(Date.parse(state.session.date_start)+hours*3600000).toISOString()}));
  return estimateTrackEvolution();
})()`);
assert.ok(Math.abs(trend.slope+4)<1e-9);
const real=run(`(() => {
  state.source='demo';state.session=frozen.session;state.selectedA=4;state.selectedB=81;state.drivers=frozen.drivers;
  state.replayData=new Map(frozen.datasets.filter(d=>d.lap.lap_number===25).map(d=>[d.lap.driver_number,d]));
  buildDistancePerformanceAnalysis();
  const a=state.distanceAnalysis.lapA,b=state.distanceAnalysis.lapB;
  const d=localDeltaAt(a,b,.5)-localDeltaAt(a,b,.3), elapsed=(observedAt(a.path,.5,'t')-observedAt(a.path,.3,'t'))-(observedAt(b.path,.5,'t')-observedAt(b.path,.3,'t'));
  // Boundary preservation changes normalized progress, not the physical interval.
  // These A timestamps locate the former version-7 30–50% window exactly.
  const oldTimes=[26.946459985676672,45.70826107212794];
  const mapped=oldTimes.map(t=>interpolateField(a.path,t,'t','progress'));
  const samePhysicalDelta=localDeltaAt(a,b,mapped[1])-localDeltaAt(a,b,mapped[0]);
  return {finish:state.distanceAnalysis.finishDelta,sectors:sectorChecks(),intervalDelta:d,elapsedDifference:elapsed,mappedOldWindow:mapped,samePhysicalDelta};
})()`);
assert.ok(Math.abs(real.finish+.131)<1e-9);[-.09,-.038,-.003].forEach((v,i)=>assert.ok(Math.abs(real.sectors[i].sectorDelta-v)<1e-9));
assert.ok(Math.abs(real.sectors[0].residual)>.03&&Math.abs(real.sectors[0].residual)<.06,"No fit to force S1 agreement");
assert.ok(Math.abs(real.intervalDelta-real.elapsedDifference)<1e-9);
assert.ok(Math.abs(real.samePhysicalDelta-(-.08467140636286885))<1e-9,"Preserve the old result at the same physical positions");
console.log(JSON.stringify({result:"reported issue regressions passed",boundary,fit,trend,real},null,2));
