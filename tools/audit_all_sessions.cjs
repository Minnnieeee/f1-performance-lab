"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const P=require('../dist/pace-engine.js'),E=require('../dist/race-engine.js');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.sites-runtime/openf1-full');
const tally=(o,k)=>{o[k]=(o[k]||0)+1;};
const metric=()=>({n:0,absolute:0,bias:0});
function add(m,error){m.n++;m.absolute+=Math.abs(error);m.bias+=error;}
const finish=m=>({n:m.n,mae:m.n?+(m.absolute/m.n).toFixed(4):null,bias:m.n?+(m.bias/m.n).toFixed(4):null});
function audit(data){
  const p=P.prepare(data),s=data.session;
  const r={sessionKey:s.session_key,meetingKey:s.meeting_key,year:s.year,name:s.session_name,type:s.session_type,location:s.location,cancelled:!!s.is_cancelled,drivers:p.byDriver.size,laps:p.laps.length,origins:0,available:0,trendAvailable:0,withheld:{},lapQuality:{},horizons:[1,2,3].map(h=>({h,eligible:0,excluded:{},recent:metric(),trend:metric(),pairedRecent:metric(),threeLapRecent:metric(),oneLapRecent:metric(),twoLapRecent:metric()}))};
  for(const lap of p.laps)tally(r.lapQuality,p.reason(lap)||'usable');
  const bestErrors=[];
  for(const [driver,laps] of p.byDriver){const map=new Map(laps.map(l=>[l.lap_number,l]));
    for(const origin of laps){
      if(!Number.isFinite(E.end(origin)))continue;r.origins++;
      const f=P.forecast(p,driver,origin.lap_number);if(f.reason)tally(r.withheld,f.reason);else if(f.n<3)tally(r.withheld,'fewer_than_three_recent_laps');else r.available++;
      if(!f.reason)r.referenceAvailable=(r.referenceAvailable||0)+1;
      if(f.trend[0]?.value!==null&&f.trend[0]?.value!==undefined)r.trendAvailable++;
      for(const m of r.horizons){
        const target=map.get(origin.lap_number+m.h);
        const reason=!target?'missing_target':p.stintFor(target)?.stint_number!==p.stintFor(origin)?.stint_number?'stint_change':p.reason(target);
        if(reason){tally(m.excluded,reason);continue;}m.eligible++;
        const recent=f.recent[m.h-1]?.value,trend=f.trend[m.h-1]?.value;
        if(recent!=null){add(m.recent,recent-target.lap_duration);add(m.threeLapRecent,recent-target.lap_duration);}
        if(!f.reason&&f.n<3)add(f.n===1?m.oneLapRecent:m.twoLapRecent,f.reference-target.lap_duration);
        if(trend!=null){add(m.trend,trend-target.lap_duration);add(m.pairedRecent,recent-target.lap_duration);}
        if(m.h===1&&recent!=null){bestErrors.push({driver,origin:origin.lap_number,target:target.lap_number,actual:target.lap_duration,recentError:+(recent-target.lap_duration).toFixed(3),trendError:trend==null?null:+(trend-target.lap_duration).toFixed(3)});bestErrors.sort((a,b)=>Math.abs(b.recentError)-Math.abs(a.recentError));bestErrors.length=Math.min(2,bestErrors.length);}
      }
    }
  }
  r.worst=bestErrors;r.horizons=r.horizons.map(m=>({...m,...Object.fromEntries(['recent','trend','pairedRecent','threeLapRecent','oneLapRecent','twoLapRecent'].map(k=>[k,finish(m[k])]))}));return r;
}
async function main(){
  const catalog=JSON.parse(fs.readFileSync(path.join(dir,'sessions.json'),'utf8'));
  const asOf=new Date().toISOString(),sessions=catalog.filter(s=>s.year>=2023&&s.year<=2026&&!s.is_cancelled&&Date.parse(s.date_end)<Date.parse(asOf));
  const results=[],inputHashes={};
  for(const key of [...new Set(sessions.map(s=>s.meeting_key))]){
    const names=['laps','stints','race_control','pit'];
    let missing=names.filter(e=>!fs.existsSync(path.join(dir,`${key}-${e}.json`)));
    while(missing.length&&!fs.existsSync(path.join(dir,'collection.json'))){await new Promise(r=>setTimeout(r,10000));missing=names.filter(e=>!fs.existsSync(path.join(dir,`${key}-${e}.json`)));}
    if(missing.length){for(const s of sessions.filter(s=>s.meeting_key===key))results.push({sessionKey:s.session_key,year:s.year,type:s.session_type,name:s.session_name,location:s.location,cancelled:!!s.is_cancelled,error:'Missing downloaded endpoints: '+missing.join(',')});continue;}
    const source={};for(const e of names){const name=`${key}-${e}.json`,raw=fs.readFileSync(path.join(dir,name));inputHashes[name]=crypto.createHash('sha256').update(raw).digest('hex');source[e]=JSON.parse(raw);}
    for(const session of sessions.filter(s=>s.meeting_key===key)){
      const select=e=>source[e].filter(r=>r.session_key===session.session_key);
      results.push(audit({session,laps:select('laps'),stints:select('stints'),raceControl:select('race_control'),pits:select('pit')}));
    }
    console.log(`Audited ${results.length}/${sessions.length} sessions`);
  }
  const groups=[];
  for(const year of [2023,2024,2025,2026])for(const type of [...new Set(results.filter(r=>r.year===year).map(r=>r.type))]){
    const rows=results.filter(r=>r.year===year&&r.type===type),good=rows.filter(r=>!r.error);
    const horizons=[1,2,3].map(h=>{const out={h,eligible:good.reduce((n,r)=>n+r.horizons[h-1].eligible,0)};for(const k of ['recent','trend','pairedRecent','threeLapRecent','oneLapRecent','twoLapRecent']){const m=metric();for(const r of good){const v=r.horizons[h-1][k];m.n+=v.n;m.absolute+=(v.mae||0)*v.n;m.bias+=(v.bias||0)*v.n;}out[k]=finish(m);}return out;});
    groups.push({year,type,sessions:rows.length,downloadErrors:rows.length-good.length,withTiming:good.filter(r=>r.laps>0).length,withForecast:good.filter(r=>r.available>0).length,withTrend:good.filter(r=>r.trendAvailable>0).length,origins:good.reduce((n,r)=>n+r.origins,0),available:good.reduce((n,r)=>n+r.available,0),trendAvailable:good.reduce((n,r)=>n+r.trendAvailable,0),horizons});
  }
  const report={schema:1,asOf,cancelled:catalog.filter(s=>s.year>=2023&&s.year<=2026&&s.is_cancelled&&Date.parse(s.date_end)<Date.parse(asOf)).map(s=>({sessionKey:s.session_key,year:s.year,name:s.session_name,location:s.location})),engineHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist/pace-engine.js'))).digest('hex'),scope:'All completed OpenF1 catalog entries in 2023–2026 at retrieval, including practice, qualifying, sprint and preseason testing; every recorded driver. Public lap timing, not clean-air pace or pit-strategy outcome validation.',protocol:'Freeze each completed driver lap. Same recorded stint; past-only 8% preparation-lap filter. Recent forecast requires exactly three prior eligible laps. One/two-lap averages are retained as reference-only diagnostics, not included in available/scored forecast counts. Trend uses >=3 known-age points and the existing bounded support rule. Defaults fuel=0.035, age allowance=5. Score numbered +1/+2/+3 targets, same stint, valid non-pit timing, green/inferred-green, no observed local yellow; complete sector timing when supplied, sum within 0.1s. A lap may finish after chequered but a forecast cannot originate after that phase ends. Explicit non-race pit-out events do not exclude the following flying lap. Never remove slow future targets. Traffic, fuel load, run plan and surface changes are uncontrolled; qualifying cooldown laps remain scoreable. Compare trend to recent mean only on paired targets. Overlapping origins are not independent experiments. This run does not measure full pit-strategy availability.',groups,sessions:results,inputHashes};
  fs.writeFileSync(path.join(root,'dist/data/session-audit.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({complete:true,sessions:results.length,withForecast:results.filter(r=>r.available>0).length,withTrend:results.filter(r=>r.trendAvailable>0).length,errors:results.filter(r=>r.error).length}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={audit};
