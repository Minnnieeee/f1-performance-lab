"use strict";
// Fixed, descriptive historical checks. No tuning, resampling or future fit data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const E=require('../dist/race-engine.js');
const ROOT=path.resolve(__dirname,'..'),FUEL=.035,EXTRA=5;
const files=['race-austin.json','race-demo.json','race-monza.json','race-singapore.json'];
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=x=>x===null?null:Number(x.toFixed(4));
const tally=(o,k)=>{o[k]=(o[k]||0)+1;};
const sameStint=(d,id,n)=>d.stints.filter(s=>s.driver_number===id&&s.lap_start<=n).sort((a,b)=>a.lap_start-b.lap_start).at(-1);
function eligibility(d,lap,controls) {
  if(!lap||!Number.isFinite(E.end(lap))||lap.lap_number<=1||lap.deleted||lap.is_accurate===false)return 'missing_or_invalid_lap';
  if(lap.is_pit_out_lap||lap.is_pit_in_lap||d.pits.some(p=>p.driver_number===lap.driver_number&&(p.lap_number===lap.lap_number||p.lap_number+1===lap.lap_number)))return 'pit_or_outlap';
  const start=E.time(lap.date_start),end=E.end(lap);
  const states=[E.controlAt(controls,start).status,...controls.filter(c=>E.time(c.date)>start&&E.time(c.date)<=end).map(c=>E.controlAt(controls,E.time(c.date)).status)];
  if(states.some(s=>!['GREEN','GREEN_INFERRED'].includes(s)))return 'control_affected_or_unknown';
  const exposure=E.trafficExposure(d.intervals,lap.driver_number,start,end);
  if(exposure.coverage<.8)return 'traffic_coverage_below_80pct';
  if(exposure.fraction>.2)return 'close_traffic_above_20pct';
  return null;
}
function metrics(rows){return {n:rows.length,modelMAE:round(mean(rows.map(r=>Math.abs(r.error)))),modelBias:round(mean(rows.map(r=>r.error))),baselineMAE:round(mean(rows.map(r=>Math.abs(r.baselineError)))),baselineBias:round(mean(rows.map(r=>r.baselineError)))};}
function runValidation(){
  const all=[],sessions=[],replacements=[],hashes={};
  for(const filename of files){
    const raw=fs.readFileSync(path.join(ROOT,'dist/data',filename));hashes[filename]=crypto.createHash('sha256').update(raw).digest('hex');
    const d=JSON.parse(raw),scored=[],counts=[1,2,3].map(h=>({h,origins:0,excluded:{},eligible:0,withheld:{},scored:0}));
    const finalTime=Math.max(...d.laps.map(E.end).filter(Number.isFinite));
    // Future records are used only to classify observed outcomes, never to fit forecasts.
    const controls=E.withRestartEstimates(d.raceControl,d.laps,finalTime);
    const cache=new Map(),snapAt=cut=>{if(!cache.has(cut))cache.set(cut,E.snapshot(d,cut,FUEL,EXTRA));return cache.get(cut);};
    for(const id of [d.driverA,d.driverB]){
      const laps=d.laps.filter(l=>l.driver_number===id&&Number.isFinite(E.end(l))).sort((a,b)=>a.lap_number-b.lap_number);
      for(const origin of laps){
        const cut=E.end(origin),stint=sameStint(d,id,origin.lap_number);
        if(!stint)continue;
        const row=snapAt(cut).rows.find(r=>r.driver===id),model=row?.pace;
        for(const h of [1,2,3]){
          const c=counts[h-1];c.origins++;
          const target=laps.find(l=>l.lap_number===origin.lap_number+h);
          const targetStint=target&&sameStint(d,id,target.lap_number);
          if(!target||targetStint?.stint_number!==stint.stint_number){tally(c.excluded,'missing_target_or_stint_change');continue;}
          const why=eligibility(d,target,controls);if(why){tally(c.excluded,why);continue;}c.eligible++;
          if(!model){tally(c.withheld,'no_pre_cutoff_fit');continue;}
          const age=row.age+h-1;
          if(!E.supported(model,age,EXTRA)){tally(c.withheld,model.slope<0?'negative_trend_extrapolation':'age_support');continue;}
          const recent=model.points.slice(-3);
          if(recent.length<3){tally(c.withheld,'fewer_than_three_baseline_laps');continue;}
          const prediction=E.paceAt(model,age,target.lap_number,FUEL);
          const baseline=mean(recent.map(p=>p.y-FUEL*Math.max(0,p.lap-1)));
          scored.push({session:d.session.session_key,driver:id,origin:origin.lap_number,target:target.lap_number,h,prediction,actual:target.lap_duration,error:prediction-target.lap_duration,baselineError:baseline-target.lap_duration});c.scored++;
        }
      }
      const stints=d.stints.filter(s=>s.driver_number===id).sort((a,b)=>a.lap_start-b.lap_start);
      for(let i=1;i<stints.length;i++){
        const next=stints[i];if(!stints.slice(0,i).some(s=>s.compound===next.compound))continue;
        const pit=d.pits.filter(p=>p.driver_number===id&&p.lap_number>=next.lap_start-2&&p.lap_number<=next.lap_start).sort((a,b)=>E.time(a.date)-E.time(b.date))[0];
        const decision=laps.filter(l=>l.lap_number<next.lap_start&&E.end(l)<(pit?E.time(pit.date):Infinity)&&!l.is_pit_out_lap&&!d.pits.some(p=>p.driver_number===id&&p.lap_number===l.lap_number)).at(-1);
        if(!decision){replacements.push({session:d.session.session_key,driver:id,stint:next.stint_number,reason:'no_pre_stop_cutoff'});continue;}
        const row=snapAt(E.end(decision)).rows.find(r=>r.driver===id),model=E.selectModel(row,next.compound);
        const event={session:d.session.session_key,driver:id,compound:next.compound,stint:next.stint_number,cutoffLap:decision.lap_number,sourceStint:model?.stint??null,sourceFit:model?{n:model.n,minAge:model.minAge,maxAge:model.maxAge,slope:round(model.slope)}:null,ageZeroSupported:!!E.supported(model,0,EXTRA),newSetAge:next.tyre_age_at_start,observed:[],excluded:{}};
        // First five numbered laps of the replacement stint; never search later for favourable outcomes.
        for(let offset=0;offset<5;offset++){
          const lap=laps.find(l=>l.lap_number===next.lap_start+offset),why=eligibility(d,lap,controls);
          if(why){tally(event.excluded,why);continue;}
          if(sameStint(d,id,lap.lap_number)?.stint_number!==next.stint_number){tally(event.excluded,'stint_change');continue;}
          const age=next.tyre_age_at_start+offset,support=!!E.supported(model,age,EXTRA);
          // Do not fabricate a warm-up penalty estimate from a pit-contaminated outlap.
          const prediction=support?E.paceAt(model,age,lap.lap_number,FUEL):null;
          event.observed.push({lap:lap.lap_number,age,prediction:prediction===null?null:round(prediction),actual:lap.lap_duration,error:prediction===null?null:round(prediction-lap.lap_duration)});
        }
        replacements.push(event);
      }
    }
    all.push(...scored);sessions.push({session:d.session.session_key,name:d.session.location,drivers:[d.driverA,d.driverB],horizons:counts.map(c=>({...c,...metrics(scored.filter(r=>r.h===c.h))}))});
  }
  return {schema:1,engineHash:crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT,"dist/race-engine.js"))).digest("hex"),fuelGain:FUEL,maxExtrapolation:EXTRA,inputHashes:hashes,scope:'Four pre-existing race fixtures; only their two designated drivers have full interval histories. Overlapping forecast origins are not independent experiments. Archived records may include retrospective corrections. No tuning or claim of prospective live validation.',protocol:'At each completed driver lap, freeze the existing engine snapshot. Predict numbered laps +1/+2/+3 in the same recorded stint, using current support gates. Compare with the last three fit-eligible raw lap times averaged without correction. Score only valid non-pit green/green-inferred targets with >=80% interval coverage and <=20% close-traffic exposure. Do not exclude large forecast errors or slow target laps using a future best-lap threshold. Outcome eligibility uses future records solely for scoring. Error = predicted minus actual.',summary:[1,2,3].map(h=>({h,...metrics(all.filter(r=>r.h===h)),eligible:sessions.reduce((s,r)=>s+r.horizons[h-1].eligible,0)})),sessions,replacements,worstErrors:all.slice().sort((a,b)=>Math.abs(b.error)-Math.abs(a.error)).slice(0,3).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='number'?round(v):v])))};
}
if(require.main===module){const result=runValidation();fs.writeFileSync(path.join(ROOT,'dist/data/prediction-validation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
module.exports={runValidation,eligibility,metrics};
