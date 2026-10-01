"use strict";
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'dist',n),'utf8');
function analyse(){
 const demo=JSON.parse(read('data/demo.json'));
 const ctx=vm.createContext({demo,document:{getElementById(){return {textContent:''};}}});
 const run=s=>vm.runInContext(s,ctx),app=read('app.js'),workspace=read('workspace.js');
 run(app.slice(0,app.indexOf('document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener')));
 run(workspace.slice(workspace.indexOf('function selectionMetrics('),workspace.indexOf('function renderSelection(')));
 const traces=run(`(()=>{const ref=buildLapDistancePath(demo.datasets.find(x=>x.lap.driver_number===4&&x.lap.lap_number===25));return [22,25].map(n=>({lap:n,drivers:[4,81].map(id=>{const p=buildLapDistancePath(demo.datasets.find(x=>x.lap.driver_number===id&&x.lap.lap_number===n));if(n!==25||id!==4)projectOntoReference(p,ref);const m=selectionMetrics(p,.136,.272);return {driver:id,minimumSpeed:m.minimum?.speed??null,minimumProgress:m.minimum?.progress??null,throttleBracket:m.throttle,positionMedianGap:p.quality.medianGap,positionMaxGap:p.quality.maxGap,backwardProjections:p.quality.projectionReversals||0}})}))})()`);
 const matching=phase=>{
  const laps=demo.laps.filter(l=>l.qualifying_segment===phase&&l.is_accurate&&!l.deleted&&!l.is_pit_in_lap&&!l.is_pit_out_lap&&l.track_status==='1');
  const best=id=>Math.min(...laps.filter(l=>l.driver_number===id).map(l=>l.lap_duration));
  const clean=l=>l.lap_duration<=best(l.driver_number)*1.08;
  return laps.filter(l=>l.driver_number===4&&clean(l)).flatMap(a=>laps.filter(b=>b.driver_number===81&&clean(b)&&a.compound===b.compound&&a.tyre_age_start_lap===b.tyre_age_start_lap&&a.fresh_tyre===b.fresh_tyre&&Math.abs(Date.parse(a.date_start)-Date.parse(b.date_start))<=60000).map(b=>({phase,lapA:a.lap_number,lapB:b.lap_number,age:a.tyre_age_start_lap,startSeparation:Math.abs(Date.parse(a.date_start)-Date.parse(b.date_start))/1000,finishDelta:Number((a.lap_duration-b.lap_duration).toFixed(3)),sectorDelta:[1,2,3].map(i=>Number((a['duration_sector_'+i]-b['duration_sector_'+i]).toFixed(3))),nativeTracesAvailable:[a,b].every(l=>demo.datasets.some(d=>d.lap.driver_number===l.driver_number&&d.lap.lap_number===l.lap_number))})));
 };
 return {schema:1,scope:'Existing bundled 20 accurate timing laps and four native telemetry extracts. No claim of exhaustive full-session coverage.',matchingRule:'Same phase, compound, source-reported start age and fresh-set flag; green status; starts within 60 seconds; each lap within 8% of its driver phase best among bundled laps. Rules do not use the direction of the NOR–PIA difference. Q2 is a separate timing-only context check, not a replication of Q3.',q3Pairs:matching('Q3'),q2Pairs:matching('Q2'),traceRule:'Both L22 traces projected onto NOR L25 reference before inspecting 13.6–27.2%; no exact local time gain is inferred. Native sampled minima and throttle brackets only.',traces};
}
if(require.main===module){const result=analyse();fs.writeFileSync(path.join(root,'dist/data/case-followup.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
module.exports={analyse};
