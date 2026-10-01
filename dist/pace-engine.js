"use strict";
// Observed same-stint pace, usable in every session type. No pit/gap requirement.
const PaceEngine=(()=>{
  const E=typeof module!=="undefined"&&module.exports?require('./race-engine.js'):RaceEngine;
  const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  function prepare(data){
    const laps=(data.laps||[]).slice().sort((a,b)=>a.lap_number-b.lap_number);
    const last=Math.max(0,...laps.map(E.end).filter(Number.isFinite));
    const nonRace=!/Race|^Sprint$/i.test(data.session?.session_type||data.session?.session_name||'Race');
    const sourceControls=(data.raceControl||[]).flatMap(r=>nonRace&&!r.flag&&/^GREEN LIGHT\s*[-–]\s*PIT EXIT OPEN$/i.test(r.message||'')?[r,{date:r.date,scope:'Track',inferredRestart:true,message:'Non-race session opening inferred from pit-exit green light',sourceDate:r.date,elapsedSeconds:0,inferenceKind:'SESSION_OPEN'}]:[r]);
    const controls=E.withRestartEstimates(sourceControls,laps,last).sort((a,b)=>E.time(a.date)-E.time(b.date));
    const changes=[];let status='UNKNOWN';
    for(const r of controls){const next=E.controlAt([r],Infinity).status;if(next!=='UNKNOWN'&&next!==status){status=next;changes.push({time:E.time(r.date),status});}}
    const stateAt=t=>{let s='UNKNOWN';for(const r of changes){if(r.time>t)break;s=r.status;}return s;};
    const byDriver=new Map();for(const l of laps){if(!byDriver.has(l.driver_number))byDriver.set(l.driver_number,[]);byDriver.get(l.driver_number).push(l);}
    const stints=(data.stints||[]).slice().sort((a,b)=>a.lap_start-b.lap_start);
    const stintCache=new Map(laps.map(l=>[l,stints.filter(s=>s.driver_number===l.driver_number&&s.lap_start<=l.lap_number).at(-1)||null]));
    const stintFor=l=>stintCache.get(l)||null;
    const outlapNumbers=new Set(laps.filter(l=>l.is_pit_out_lap).map(l=>`${l.driver_number}:${l.lap_number}`));
    const classify=l=>{
      if(!l||!Number.isFinite(E.end(l))||!(E.num(l.lap_duration)>0)||l.deleted||l.is_accurate===false)return 'missing_or_invalid_timing';
      if(l.is_pit_out_lap||l.is_pit_in_lap||[...(l.segments_sector_1||[]),...(l.segments_sector_2||[]),...(l.segments_sector_3||[])].includes(2064)||(data.pits||[]).some(p=>p.driver_number===l.driver_number&&(p.lap_number===l.lap_number||!outlapNumbers.has(`${p.driver_number}:${p.lap_number}`)&&p.lap_number+1===l.lap_number)&&E.time(p.date)<=E.end(l)))return 'pit_or_outlap';
      const sectorKeys=['duration_sector_1','duration_sector_2','duration_sector_3'];
      if(sectorKeys.some(k=>Object.hasOwn(l,k))){
        const sectors=sectorKeys.map(k=>E.num(l[k]));
        if(sectors.some(v=>v===null||v<=0))return 'incomplete_sector_timing';
        if(Math.abs(sectors.reduce((s,v)=>s+v,0)-l.lap_duration)>.1)return 'inconsistent_sector_timing';
      }
      const start=E.time(l.date_start),finish=E.end(l),states=[stateAt(start),...changes.filter(r=>r.time>start&&r.time<=finish).map(r=>r.status)];
      if(!['GREEN','GREEN_INFERRED'].includes(states[0])||states.some(s=>!['GREEN','GREEN_INFERRED','FINISHED'].includes(s))||states.includes('FINISHED')&&states.slice(states.indexOf('FINISHED')+1).some(s=>s!=='FINISHED'))return states.includes('UNKNOWN')?'unknown_track_status':'affected_track_status';
      if(controls.some(r=>E.time(r.date)>start&&E.time(r.date)<=finish&&['YELLOW','DOUBLE YELLOW'].includes(String(r.flag).toUpperCase())&&(!r.driver_number||r.driver_number===l.driver_number)))return 'local_yellow';
      return null;
    };
    const reasons=new Map(laps.map(l=>[l,classify(l)]));
    const reason=l=>reasons.has(l)?reasons.get(l):classify(l);
    return {data,laps,byDriver,stints,stintFor,reason,controls,stateAt};
  }
  function forecast(p,driver,originNumber,{fuelGain=.035,offset=0,horizon=3,maxExtrapolation=5}={}){
    const laps=p.byDriver.get(Number(driver))||[],origin=laps.find(l=>l.lap_number===Number(originNumber));
    const result={driver:Number(driver),origin:Number(originNumber),cutoff:origin&&Number.isFinite(E.end(origin))?E.end(origin):null,reason:null,recent:[],trend:[],used:[],model:null,fitReason:null};
    if(!origin||!result.cutoff){result.reason='missing_origin';return result;}
    if(p.stateAt(result.cutoff)==='FINISHED'){result.reason='session_finished';return result;}
    const originReason=p.reason(origin);
    if(originReason){result.reason=originReason;return result;}
    const stint=p.stintFor(origin);result.stint=stint?.stint_number??null;result.compound=stint?.compound??null;
    if(!stint){result.reason='missing_stint';return result;}
    const candidates=laps.filter(l=>l.lap_number<=origin.lap_number&&E.end(l)<=result.cutoff&&p.stintFor(l)?.stint_number===stint.stint_number&&!p.reason(l));
    const best=candidates.length?Math.min(...candidates.map(l=>l.lap_duration)):Infinity;
    // Past-only removal of preparation/cooldown laps; never applied to scored outcomes.
    const usable=candidates.filter(l=>l.lap_duration<=best*1.08);
    const recent=usable.slice(-3);result.used=recent.map(l=>l.lap_number);result.n=recent.length;
    if(!recent.length){result.reason='no_usable_prior_lap';return result;}
    if(origin.lap_number-recent.at(-1).lap_number>3){result.reason='stale_run';return result;}
    if(origin.is_pit_in_lap||(p.data.pits||[]).some(r=>r.driver_number===Number(driver)&&r.lap_number===origin.lap_number&&E.time(r.date)<=result.cutoff)){result.reason='pit_entry_at_origin';return result;}
    const base=mean(recent.map(l=>l.lap_duration));result.reference=base;
    const age0=E.num(stint.tyre_age_at_start),nextAge=age0===null?null:age0+origin.lap_number-stint.lap_start+1;
    const points=age0===null?[]:usable.map(l=>({x:age0+l.lap_number-stint.lap_start,y:l.lap_duration+fuelGain*Math.max(0,l.lap_number-1)}));
    result.model=E.fit(points);result.fitReason=age0===null?'missing_tyre_age':!result.model?'fewer_than_three_fit_laps':null;
    for(let h=1;h<=Math.min(3,Math.max(1,horizon));h++){
      result.recent.push({h,value:recent.length===3?base+offset:null});
      const supported=result.model&&E.supported(result.model,nextAge+h-1,maxExtrapolation);
      result.trend.push({h,value:supported?E.paceAt(result.model,nextAge+h-1,origin.lap_number+h,fuelGain)+offset:null,reason:supported?null:result.fitReason||(result.model.slope<0?'negative_trend_extrapolation':'age_support')});
    }
    return result;
  }
  return {prepare,forecast};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=PaceEngine;
