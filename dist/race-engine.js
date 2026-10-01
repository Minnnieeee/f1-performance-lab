"use strict";
// Historical, event-time analysis. Pure functions; no network, clock or UI state.
// Archived event times are not original packet arrival times.
const RaceEngine = (() => {
  const num = value => (typeof value === "number" || typeof value === "string" && value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
  const time = value => Date.parse(value || "");
  const end = lap => Number.isFinite(time(lap.date_start)) && num(lap.lap_duration)>0 ? time(lap.date_start)+num(lap.lap_duration)*1000 : Infinity;
  const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : null;
  const median = a => {const s=[...a].sort((a,b)=>a-b);return s.length ? (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2 : null;};
  const preparedTraffic=new WeakMap();
  // Explicitly prepare a fixed archive for many cutoffs. Snapshot semantics are
  // unchanged: a lap's exposure uses no interval after that completed lap.
  function prepareSnapshotData(data){
    const copy={...data,intervals:(data.intervals||[]).map(r=>({...r}))},drivers=new Map(),cache=new Map();
    for(const r of copy.intervals){const d=num(r.driver_number),t=time(r.date);if(d===null||!Number.isFinite(t))continue;if(!drivers.has(d))drivers.set(d,[]);drivers.get(d).push({t,r});}
    for(const rows of drivers.values())rows.sort((a,b)=>a.t-b.t);
    const bound=(rows,t,inclusive)=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].t<t||inclusive&&rows[mid].t===t)lo=mid+1;else hi=mid;}return lo;};
    preparedTraffic.set(copy,(driver,start,finish)=>{
      const key=`${driver}:${start}:${finish}`;if(cache.has(key))return cache.get(key);
      const rows=drivers.get(driver)||[],selected=rows.slice(bound(rows,start-10000,false),bound(rows,finish,true)).map(x=>x.r);
      const value=trafficExposure(selected,driver,start,finish);cache.set(key,value);return value;
    });return copy;
  }
  // Verified season rules are documented in review-v8.md. Unknown future years
  // use bounded lap evidence, never an unverified automatic time-based release.
  const VSC_RULE_YEARS=new Set([2023,2024,2025,2026]);
  // Data-quality caps, not FIA timing rules. Red restarts can include a
  // formation lap and grid reforming after the procedure notice.
  const RESTART_MAX_SECONDS=300,RED_RESTART_MAX_SECONDS=600,RESTART_MAX_LAP_OFFSET=2;
  const isTrackRecord=r=>String(r.scope||'').toUpperCase()==='TRACK'||(!r.scope&&!r.driver_number&&!r.sector);
  function fit(points) {
    if(points.length<3)return null;
    const x=mean(points.map(p=>p.x)),y=mean(points.map(p=>p.y));
    const xx=points.reduce((s,p)=>s+(p.x-x)**2,0);if(!xx)return null;
    const slope=points.reduce((s,p)=>s+(p.x-x)*(p.y-y),0)/xx,intercept=y-slope*x;
    const sst=points.reduce((s,p)=>s+(p.y-y)**2,0),sse=points.reduce((s,p)=>s+(p.y-intercept-slope*p.x)**2,0);
    return {slope,intercept,r2:sst>1e-12?1-sse/sst:null,n:points.length,meanAge:x,xx,residualVariance:sse/(points.length-2),minAge:Math.min(...points.map(p=>p.x)),maxAge:Math.max(...points.map(p=>p.x))};
  }
  function controlAt(records,cutoff) {
    let status="UNKNOWN",last=null;
    for(const r of records.filter(r=>time(r.date)<=cutoff).sort((a,b)=>time(a.date)-time(b.date))) {
      const m=String(r.message||"").toUpperCase(),flag=String(r.flag||"").toUpperCase(),scope=String(r.scope||"").toUpperCase();
      const global=scope==="TRACK" || (!scope && !r.driver_number && !r.sector);
      if(!global || (!flag && /PIT (?:EXIT|ENTRY)|PIT LANE/.test(m)))continue;
      let next=null;
      if(flag==="CHEQUERED" || /\bCHEQUERED FLAG\b/.test(m))next="FINISHED";
      else if(flag==="RED" || /SESSION SUSPENDED|\bRED FLAG\b/.test(m))next="RED";
      else if(r.restartUnconfirmed)next="RESTART_UNCONFIRMED";
      else if(r.inferredRestart)next="GREEN_INFERRED";
      else if(/^(?:SESSION|RACE) RESUMED\b/.test(m))next="RESTART_UNCONFIRMED";
      else if(/VIRTUAL SAFETY CAR|\bVSC\b/.test(m))next=/ENDING/.test(m)?"VSC_ENDING":/DEPLOYED/.test(m)?"VSC":null;
      else if(/SAFETY CAR/.test(m))next=/IN THIS LAP|ENDING/.test(m)?"SC_ENDING":/DEPLOYED/.test(m)?"SC":null;
      else if(flag==="GREEN" && scope==="TRACK" || /^(?:GREEN LIGHT|GREEN FLAG)(?:\s*[-–.]?\s*)$/.test(m))next="GREEN";
      if(next){status=next;last={date:r.date,message:r.message,flag:r.flag,scope:r.scope,...(r.sourceDate?{sourceDate:r.sourceDate,elapsedSeconds:r.elapsedSeconds,inferenceKind:r.inferenceKind}: {})};}
    }
    return {status,last};
  }
  function withRestartEstimates(records,laps,cutoff) {
    const observed=records.filter(r=>time(r.date)<=cutoff),result=[...observed];
    for(const r of observed) {
      const m=String(r.message||"").toUpperCase();
      const vsc=/^(?:VIRTUAL SAFETY CAR|VSC) ENDING\b/.test(m);
      const sc=/SAFETY CAR IN THIS LAP/.test(m);
      const restart=/^(?:SESSION|RACE) RESUMED\b/.test(m)||/^RACE WILL RESUME AT .*STANDING START PROCEDURE/.test(m);
      if((!vsc&&!sc&&!restart)||!isTrackRecord(r)||!Number.isFinite(time(r.date)))continue;
      const sourceTime=time(r.date),year=new Date(sourceTime).getUTCFullYear(),ruleBased=vsc&&VSC_RULE_YEARS.has(year),maxSeconds=restart?RED_RESTART_MAX_SECONDS:RESTART_MAX_SECONDS,deadline=sourceTime+maxSeconds*1000;
      let release=null,basis=null;
      if(ruleBased){
        release=sourceTime+15000;basis=`VSC inferred from verified ${year} regulation: ENDING +15s; release window +10–15s`;
      }else if(num(r.lap_number)!==null){
        const boundary=laps.filter(l=>num(l.lap_number)>=num(r.lap_number)+1&&num(l.lap_number)<=num(r.lap_number)+RESTART_MAX_LAP_OFFSET&&time(l.date_start)>sourceTime&&end(l)<=Math.min(cutoff,deadline)).sort((a,b)=>end(a)-end(b))[0];
        if(boundary){release=end(boundary);basis=restart?"Post-red restart inferred after a complete lap following a resumption/procedure notice; not the notice time":"Restart inferred after a complete post-ending lap; exact release unobserved";}
      }
      const failed=release===null,decisionTime=failed?deadline:release;
      if(decisionTime>cutoff)continue;
      const interrupted=observed.some(x=>isTrackRecord(x)&&time(x.date)>sourceTime&&time(x.date)<=decisionTime&&(/DEPLOYED|SUSPENDED|\bRED FLAG\b|ENDING|IN THIS LAP|RACE WILL RESUME|^(?:SESSION|RACE) RESUMED|^GREEN (?:LIGHT|FLAG)/.test(String(x.message||"").toUpperCase())||["RED","CHEQUERED","GREEN"].includes(String(x.flag||'').toUpperCase())));
      if(interrupted)continue;
      result.push({date:new Date(decisionTime).toISOString(),scope:"Track",inferredRestart:!failed,restartUnconfirmed:failed,inferenceKind:vsc?'VSC':sc?'SC':'RED',message:failed?`Restart unconfirmed: no eligible complete lap within ${maxSeconds}s and +${RESTART_MAX_LAP_OFFSET} lap numbers; pace fit withheld`:basis,sourceDate:r.date,elapsedSeconds:(decisionTime-sourceTime)/1000,releaseWindow:ruleBased?[new Date(sourceTime+10000).toISOString(),new Date(release).toISOString()]:null});
    }
    return result;
  }
  function trafficExposure(records,driver,start,finish) {
    const samples=[...new Map(records.filter(r=>num(r.driver_number)===driver&&time(r.date)<=finish&&time(r.date)>=start-10000).map(r=>[time(r.date),r])).values()].sort((a,b)=>time(a.date)-time(b.date));
    let known=0,close=0;
    samples.forEach((r,i)=>{const gap=num(r.interval);if(gap===null)return;const dt=Math.max(0,Math.min(finish,time(samples[i+1]?.date)||Infinity,time(r.date)+10000)-Math.max(start,time(r.date)));known+=dt;if(gap>0&&gap<1.5)close+=dt;});
    return {fraction:close/(finish-start),coverage:known/(finish-start)};
  }
  function latest(records,cutoff) {
    const map=new Map();for(const r of records){const t=time(r.date),d=num(r.driver_number);if(d!==null&&t<=cutoff&&(!map.has(d)||t>time(map.get(d).date)))map.set(d,r);}return map;
  }
  function snapshot(data,cutoff,fuelGain=0.035,maxExtrapolation=5) {
    const laps=(data.laps||[]).filter(l=>end(l)<=cutoff).sort((a,b)=>end(a)-end(b));
    const controls=withRestartEstimates((data.raceControl||[]).filter(r=>time(r.date)<=cutoff),laps,cutoff);
    // Compile the same state transitions once per snapshot, rather than sorting
    // the complete control history repeatedly for every driver's every lap.
    const controlHistory=[...new Map(controls.slice().sort((a,b)=>time(a.date)-time(b.date)).map(r=>({time:time(r.date),...controlAt([r],cutoff)})).filter(r=>r.status!=="UNKNOWN").map(r=>[r.time,r])).values()];
    const at=t=>{let out={status:"UNKNOWN",last:null};for(const r of controlHistory){if(r.time>t)break;out=r;}return {status:out.status,last:out.last};};
    const pits=(data.pits||[]).filter(p=>time(p.date)<=cutoff);
    const intervals=(data.intervals||[]).filter(r=>time(r.date)<=cutoff);
    const intervalsByDriver=new Map();for(const r of intervals){const d=num(r.driver_number);if(!intervalsByDriver.has(d))intervalsByDriver.set(d,[]);intervalsByDriver.get(d).push(r);}
    const positions=latest(data.positions||[],cutoff),gaps=latest(intervals,cutoff);
    const weather=[...(data.weather||[])].filter(r=>time(r.date)<=cutoff).sort((a,b)=>time(a.date)-time(b.date)).at(-1)||null;
    const control=at(cutoff);
    const driverIds=new Set([...(data.drivers||[]).map(d=>num(d.driver_number)),...laps.map(l=>num(l.driver_number)),...positions.keys()].filter(d=>d!==null));
    const rows=[...driverIds].map(driver=>{
      const history=laps.filter(l=>num(l.driver_number)===driver),lastLap=history.at(-1)||null;
      const currentLap=num(lastLap?.lap_number);
      // A stint must have at least one completed lap. Future lap_end is never used.
      const stints=(data.stints||[]).filter(s=>num(s.driver_number)===driver && currentLap!==null && num(s.lap_start)!==null && num(s.lap_start)<=currentLap).sort((a,b)=>num(a.lap_start)-num(b.lap_start));
      const currentStint=stints.at(-1)||null,models=[],diagnostics=[];
      for(let i=0;i<stints.length;i++) {
        const s=stints[i],start=num(s.lap_start),next=num(stints[i+1]?.lap_start)??Infinity,ageStart=num(s.tyre_age_at_start);
        const candidates=history.filter(l=>num(l.lap_number)>=start&&num(l.lap_number)<next && num(l.lap_number)>1 && !l.is_pit_out_lap && !l.is_pit_in_lap && !l.deleted && l.is_accurate!==false);
        const knownPit=new Set(pits.filter(p=>num(p.driver_number)===driver).map(p=>num(p.lap_number)));
        const plausible=candidates.filter(l=>!knownPit.has(num(l.lap_number)) && !knownPit.has(num(l.lap_number)-1));
        const best=plausible.length?Math.min(...plausible.map(l=>num(l.lap_duration))):Infinity;
        let excluded=0,trafficUnknown=0,controlUnknown=0,controlInferred=0,controlRecorded=0,unknownControlExcluded=0,restartUnconfirmedExcluded=0;
        const points=[];
        for(const l of plausible) {
          const startTime=time(l.date_start),finish=end(l),n=num(l.lap_number),age=ageStart===null?null:ageStart+n-start;
          const exposure=preparedTraffic.has(data)?preparedTraffic.get(data)(driver,startTime,finish):trafficExposure(intervalsByDriver.get(driver)||[],driver,startTime,finish);
          const flags=at(startTime).status;
          const lapStates=[flags,...controlHistory.filter(r=>r.time>startTime&&r.time<=finish).map(r=>r.status)];
          const affected=lapStates.some(s=>!["GREEN","GREEN_INFERRED"].includes(s));
          if(lapStates.includes('UNKNOWN'))unknownControlExcluded++;
          if(lapStates.includes('RESTART_UNCONFIRMED'))restartUnconfirmedExcluded++;
          if(age===null||age<0||num(l.lap_duration)>best*1.08||affected||exposure.fraction>.2){excluded++;continue;}
          if(exposure.coverage<.8)trafficUnknown++;if(flags==="GREEN")controlRecorded++;else if(flags==="GREEN_INFERRED")controlInferred++;else controlUnknown++;
          points.push({x:age,y:num(l.lap_duration)+fuelGain*Math.max(0,n-1),lap:n,date_start:l.date_start,end:finish});
        }
        const regression=fit(points);
        diagnostics.push({stint:num(s.stint_number),compound:s.compound,total:history.filter(l=>num(l.lap_number)>=start&&num(l.lap_number)<next).length,used:points.length,excluded,trafficUnknown,unknownControlExcluded,restartUnconfirmedExcluded});
        if(regression)models.push({...regression,driver,compound:s.compound||"UNKNOWN",stint:num(s.stint_number),lapStart:start,lapEnd:Math.max(...points.map(p=>p.lap)),excluded,trafficUnknown,controlUnknown,controlInferred,controlRecorded,points});
      }
      const startAge=num(currentStint?.tyre_age_at_start),startLap=num(currentStint?.lap_start);
      const age=startAge!==null&&startLap!==null&&currentLap!==null?startAge+currentLap-startLap+1:null;
      const p=positions.get(driver),g=gaps.get(driver),position=num(p?.position);
      const gapAge=g?(cutoff-time(g.date))/1000:null;
      // Only a contemporaneous observed P1 may turn its null gap into zero.
      const leader=position===1&&g&&g.gap_to_leader===null&&time(p.date)<=time(g.date);
      const gapRaw=g?.gap_to_leader??null,gap=leader?0:num(gapRaw);
      const gapValid=gap!==null&&gap>=0&&gapAge!==null&&gapAge<=15;
      const pace=models.filter(m=>m.stint===num(currentStint?.stint_number)).at(-1)||null;
      const recent=lastLap&&cutoff-end(lastLap)<180000;
      return {driver,position,positionDate:p?.date||null,gap:gapValid?gap:null,gapRaw,gapDate:g?.date||null,gapAge,interval:num(g?.interval),lastLap:currentLap,lastLapTime:num(lastLap?.lap_duration),lastLapEnd:lastLap?end(lastLap):null,compound:currentStint?.compound||null,age,models,diagnostics,pace,recent:!!recent,nextPace:recent&&pace&&age!==null&&supported(pace,age,maxExtrapolation)?pace.intercept+pace.slope*age-fuelGain*currentLap:null};
    }).sort((a,b)=>(a.position??999)-(b.position??999)||a.driver-b.driver);
    const restartDiagnostics=controls.filter(r=>r.inferredRestart||r.restartUnconfirmed).map(r=>({sourceDate:r.sourceDate,date:r.date,kind:r.inferenceKind,elapsedSeconds:r.elapsedSeconds,status:r.restartUnconfirmed?'RESTART_UNCONFIRMED':'GREEN_INFERRED',message:r.message,releaseWindow:r.releaseWindow}));
    return {cutoff,cutoffISO:new Date(cutoff).toISOString(),fuelGain,control,restartDiagnostics,weather,rows,completedLaps:laps.length,provenance:"Archived event-time reconstruction, not original receipt-time replay",gapLimitSeconds:15};
  }
  const paceAt=(model,age,raceLap,fuel)=>model?model.intercept+model.slope*age-fuel*Math.max(0,raceLap-1):null;
  const supported=(m,age,maxExtra=5)=>m&&age>=m.minAge-maxExtra&&age<=m.maxAge+maxExtra&&!(m.slope<0&&(age<m.minAge||age>m.maxAge));
  function fitInterval(weights) {
    let variance=0,df=Infinity;
    for(const {model:m,w0,w1} of Object.values(weights)) {if(!Number.isFinite(m.residualVariance))return null;variance+=m.residualVariance*(w0*w0/m.n+(w1-m.meanAge*w0)**2/m.xx);if(w0||w1)df=Math.min(df,m.n-2);}
    const critical=df===Infinity?1.96:df<=30?[0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.16,2.145,2.131,2.12,2.11,2.101,2.093,2.086,2.08,2.074,2.069,2.064,2.06,2.056,2.052,2.048,2.045,2.042][Math.max(1,df)]:2;
    return critical*Math.sqrt(Math.max(0,variance));
  }
  function contrastWeights(a,b) {const out=Object.fromEntries(Object.entries(a).map(([k,v])=>[k,{...v}]));for(const [k,v] of Object.entries(b)){if(!out[k])out[k]={...v,w0:0,w1:0};out[k].w0-=v.w0;out[k].w1-=v.w1;}return out;}
  function selectModel(row,compound) {return row?.models.filter(m=>m.compound===compound).sort((a,b)=>b.lapEnd-a.lapEnd)[0]||null;}
  function validPair(a,b) {
    if(!a||!b||a.driver===b.driver)return "select_two_drivers";
    if(!a.recent||!b.recent)return "no_recent_completed_lap";
    if(!a.pace||!b.pace||a.age===null||b.age===null)return "insufficient_pace_age_data";
    if(a.gap===null||b.gap===null)return "missing_stale_or_lapped_gap";
    if(Math.abs(time(a.gapDate)-time(b.gapDate))>5000)return "asynchronous_gaps";
    return null;
  }
  function simulatePair(a,b,inputs,stopA,stopB,condition="GREEN",bias=0,diagnostic=false) {
    const freshA=selectModel(a,inputs.compoundA||a.compound),freshB=selectModel(b,inputs.compoundB||b.compound);
    if(!freshA||!freshB)return null;
    let gap=a.gap-b.gap;const weights={},warnings=new Set(),extrapolation={low:0,high:0},points=[{lap:0,gap,paceA:null,paceB:null,pitA:false,pitB:false}];
    for(let lap=0;lap<inputs.horizon;lap++) {
      const neutral=lap<inputs.neutralLaps&&/^(SC|VSC)/.test(condition),factor=neutral?(condition.startsWith("SC")?inputs.scFactor:inputs.vscFactor):1;
      // Equal neutralised lap duration preserves gaps; SC compression is NOT modelled.
      const modelA=lap>=stopA?freshA:a.pace,modelB=lap>=stopB?freshB:b.pace,ageA=lap>=stopA?lap-stopA:a.age+lap,ageB=lap>=stopB?lap-stopB:b.age+lap;
      const commonLap=Math.max(a.lastLap,b.lastLap)+1+lap;
      if(!neutral&&(!supported(modelA,ageA,inputs.maxExtrapolation??5)||!supported(modelB,ageB,inputs.maxExtrapolation??5))){if(!diagnostic)return null;warnings.add("unsupported_diagnostic_only");}
      let pa=paceAt(modelA,ageA,commonLap,inputs.fuelGain);
      let pb=paceAt(modelB,ageB,commonLap,inputs.fuelGain);
      if(!Number.isFinite(pa)||!Number.isFinite(pb)||pa<=0||pb<=0)return null;
      if(neutral)pa=pb=0; // Gap increments only; no invented absolute neutral lap time.
      else {pa+=bias*inputs.paceRange/2;pb-=bias*inputs.paceRange/2;
        for(const [m,age,sign,driver] of [[modelA,ageA,1,a.driver],[modelB,ageB,-1,b.driver]]){const key=driver+":"+m.stint;weights[key]??={model:m,w0:0,w1:0};weights[key].w0+=sign;weights[key].w1+=sign*age;if(age<m.minAge||age>m.maxAge)warnings.add("age_extrapolation");extrapolation.low=Math.max(extrapolation.low,m.minAge-age);extrapolation.high=Math.max(extrapolation.high,age-m.maxAge);}
      }
      if(lap===stopA)pa+=Math.max(0,inputs.pitLoss+bias*inputs.pitRange/2)*factor+(inputs.warmupA??inputs.warmup);
      if(lap===stopB)pb+=Math.max(0,inputs.pitLoss-bias*inputs.pitRange/2)*factor+(inputs.warmupB??inputs.warmup);
      // User-set incremental traffic cost after a stop; not a measured tyre penalty.
      if(lap>=stopA&&lap<stopA+inputs.trafficLaps)pa+=inputs.trafficA;
      if(lap>=stopB&&lap<stopB+inputs.trafficLaps)pb+=inputs.trafficB;
      gap+=pa-pb;points.push({lap:lap+1,gap,paceA:neutral?null:pa,paceB:neutral?null:pb,pitA:lap===stopA,pitB:lap===stopB,neutral});
    }
    const bothStoppedAt=Math.max(stopA,stopB)+1;
    return {stopA,stopB,bothStoppedAt,afterBoth:points[bothStoppedAt]?.gap??null,finishGap:points.at(-1).gap,points,weights,fitHalfWidth:fitInterval(weights),warnings:[...warnings],extrapolation,algebraOnly:diagnostic};
  }
  function evaluate(snapshot,aId,bId,inputs) {
    const a=snapshot.rows.find(r=>r.driver===aId),b=snapshot.rows.find(r=>r.driver===bId);
    const condition=inputs.condition==="observed"?snapshot.control.status:inputs.condition;
    const sc=condition.startsWith("SC"),vsc=condition.startsWith("VSC"),hold=["RED","UNKNOWN","FINISHED","RESTART_UNCONFIRMED"].includes(condition);
    const savings={green:inputs.pitLoss,SC:inputs.pitLoss*inputs.scFactor,VSC:inputs.pitLoss*inputs.vscFactor};
    const reason=validPair(a,b)||(!selectModel(a,inputs.compoundA||a?.compound)||!selectModel(b,inputs.compoundB||b?.compound)?"new_compound_has_no_prior_fit":null)||(hold?"unknown_or_red_control":null);
    const result={condition,conditionSource:inputs.condition==="observed"?(condition==="GREEN_INFERRED"?"inferred_from_records":"recorded"):"user_scenario",savings,reason,a:a||null,b:b||null,scenarios:[],rejoin:null,pitWindows:[],rankHold:sc||vsc,inputs};
    result.replacementEvidence=[a,b].filter(Boolean).map(row=>{const compound=row===a?inputs.compoundA:inputs.compoundB,m=selectModel(row,compound||row.compound);return {driver:row.driver,stint:m?.stint,compound:m?.compound,sameAsCurrent:!!m&&m===row.pace,ageZeroObserved:!!m&&m.minAge<=0,independentReplacementValidation:false};});
    if(reason)return result;
    const definitions=[{id:"undercut",stopA:0,stopB:inputs.delay},{id:"overcut",stopA:inputs.delay,stopB:0},{id:"together",stopA:0,stopB:0}];
    result.scenarios=definitions.map(d=>{
      const variants=[-1,0,1].map(bias=>simulatePair(a,b,inputs,d.stopA,d.stopB,condition,bias));
      if(variants.some(v=>!v))return {...d,unavailable:true};
      return {...d,...variants[1],rangeAtBoth:[Math.min(...variants.map(v=>v.afterBoth)),Math.max(...variants.map(v=>v.afterBoth))],rangeAtHorizon:[Math.min(...variants.map(v=>v.finishGap)),Math.max(...variants.map(v=>v.finishGap))]};
    });
    result.pitWindows=Array.from({length:inputs.horizon},(_,offset)=>{
      const s=simulatePair(a,b,inputs,offset,inputs.delay,condition,0);return {offset,finishGap:s?.finishGap??null};
    });
    result.pitWindows.forEach((w,i)=>{const next=result.pitWindows[i+1];w.nextLapDelayCost=Number.isFinite(w.finishGap)&&Number.isFinite(next?.finishGap)?next.finishGap-w.finishGap:null;});
    const baseline=result.scenarios.find(s=>s.id==="together");
    result.comparisons=result.scenarios.filter(s=>s!==baseline&&!s.unavailable&&!baseline?.unavailable).map(s=>({id:s.id,delta:s.finishGap-baseline.finishGap,fitHalfWidth:fitInterval(contrastWeights(s.weights,baseline.weights))}));
    result.comparisons.forEach(c=>{const scenario=result.scenarios.find(s=>s.id===c.id),cw=contrastWeights(scenario.weights,baseline.weights);c.parameterCancellation=Object.values(cw).every(w=>w.w0===0&&w.w1===0);c.mechanism=Object.values(cw).filter(w=>Math.abs(w.w0)+Math.abs(w.w1)>1e-10).map(w=>({driver:w.model.driver,stint:w.model.stint,slope:w.model.slope,ageWeight:w.w1,interceptWeight:w.w0}));});
    const boundaryEligible=/^GREEN/.test(condition)&&result.replacementEvidence.every(e=>e.sameAsCurrent)&&inputs.trafficA===0&&inputs.trafficB===0;
    result.signBoundaries=boundaryEligible?[{id:'undercut',row:b,sign:-1},{id:'overcut',row:a,sign:1}].map(({id,row,sign})=>({id,age:row.age,slope:row.pace.slope,zeroHorizon:row.age+inputs.delay,distance:row.age+inputs.delay-inputs.horizon,algebraicDelta:sign*inputs.delay*(row.age+inputs.delay-inputs.horizon)*row.pace.slope,forecastAvailable:result.comparisons.some(c=>c.id===id)})):[];
    const missing=result.pitWindows.filter(w=>!Number.isFinite(w.finishGap)).map(w=>w.offset);
    const sameA=selectModel(a,inputs.compoundA||a.compound)===a.pace;
    result.scanSupport={missing,total:inputs.horizon,limit:inputs.maxExtrapolation??5,positiveSlopeShortHorizon:sameA&&a.pace.slope>0&&a.age>inputs.horizon-1&&!sc&&!vsc&&inputs.trafficA===0,age:a.age,horizonMinusOne:inputs.horizon-1};
    result.fuelSensitivity=fuelSensitivity(snapshot,aId,bId,inputs,condition);
    result.decision="Exploratory scenarios only; no operational ranking. Fit intervals omit track evolution, model-form error and correlated residuals.";
    if(!result.rankHold) {
      const targetGap=a.gap+inputs.pitLoss;
      // Frozen-field time-loss approximation, not physical pit-exit geometry.
      const eligible=snapshot.rows.filter(r=>r.driver!==aId&&r.recent&&r.gap!==null&&Math.abs(time(r.gapDate)-time(a.gapDate))<=5000);
      const ahead=eligible.filter(r=>r.gap<targetGap).sort((x,y)=>y.gap-x.gap)[0]||null;
      const behind=eligible.filter(r=>r.gap>=targetGap).sort((x,y)=>x.gap-y.gap)[0]||null;
      result.rejoin={timeLoss:inputs.pitLoss,targetGap,rank:1+eligible.filter(r=>r.gap<targetGap).length,among:eligible.length+1,fullField:eligible.length===snapshot.rows.length-1,ahead:ahead?{driver:ahead.driver,gap:targetGap-ahead.gap}:null,behind:behind?{driver:behind.driver,gap:behind.gap-targetGap}:null,definition:"Frozen-field net pit-loss estimate; other cars retain gaps and do not pit. Not an absolute pit-exit position prediction."};
    }
    return result;
  }
  function fuelSensitivity(snap,aId,bId,inputs,condition) {
    return [0,inputs.fuelGain,.15].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b).map(fuel=>{
      const deltaFuel=fuel-snap.fuelGain;
      const rows=[aId,bId].map(id=>{const row=snap.rows.find(r=>r.driver===id);if(!row)return null;
        const models=row.models.map(m=>{const p=m.points?.[0];return {...m,slope:m.slope+deltaFuel,intercept:m.intercept+deltaFuel*((p?.lap??m.lapStart)-1-(p?.x??m.minAge))};});
        return {...row,models,pace:models.find(m=>m.stint===row.pace?.stint)||null};});
      const [a,b]=rows;if(!a?.pace||!b?.pace)return {fuel,comparisons:[]};
      const applied={...inputs,fuelGain:fuel},baseline=simulatePair(a,b,applied,0,0,condition,0,true);
      const comparisons=[{id:"undercut",stopA:0,stopB:inputs.delay},{id:"overcut",stopA:inputs.delay,stopB:0}].map(d=>{const s=simulatePair(a,b,applied,d.stopA,d.stopB,condition,0,true);return {id:d.id,algebraicDelta:s&&baseline?s.finishGap-baseline.finishGap:null,supported:!!s&&!!baseline&&!s.warnings.includes("unsupported_diagnostic_only")&&!baseline.warnings.includes("unsupported_diagnostic_only")};});
      return {fuel,slopeA:a.pace.slope,slopeB:b.pace.slope,comparisons};
    });
  }
  return {num,time,end,supported,prepareSnapshotData,fuelSensitivity,withRestartEstimates,fitInterval,contrastWeights,trafficExposure,fit,controlAt,snapshot,paceAt,selectModel,validPair,simulatePair,evaluate};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=RaceEngine;
