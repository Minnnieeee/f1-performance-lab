"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const E=require('../dist/race-engine.js'),{inputs:defaults}=require('../tests/race_fixtures.cjs');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.sites-runtime/openf1-full');
const tally=(o,k)=>{o[k]=(o[k]||0)+1;};
async function main(){
 const catalog=JSON.parse(fs.readFileSync(path.join(dir,'sessions.json'))),asOf=new Date().toISOString();
 const sessions=catalog.filter(s=>s.year>=2023&&s.year<=2026&&!s.is_cancelled&&Date.parse(s.date_end)<Date.parse(asOf)&&/Race/i.test(s.session_type)),results=[],inputHashes={};
 const inputs={...defaults,compoundA:null,compoundB:null,maxExtrapolation:5};
 for(const session of sessions){
  const key=session.meeting_key,names=['laps','stints','race_control','pit','position','intervals'];
  let missing=names.filter(e=>!fs.existsSync(path.join(dir,`${key}-${e}.json`)));
  while(missing.length&&!(fs.existsSync(path.join(dir,'gap-collection.json'))&&fs.existsSync(path.join(dir,'collection.json')))){await new Promise(r=>setTimeout(r,10000));missing=names.filter(e=>!fs.existsSync(path.join(dir,`${key}-${e}.json`)));}
  const r={sessionKey:session.session_key,year:session.year,name:session.session_name,location:session.location,cutoffs:0,available:0,control:{},withheld:{},examples:[]};
  if(missing.length){r.error='Missing downloaded endpoints: '+missing.join(',');results.push(r);continue;}
  const data={session,drivers:[],weather:[]},mapping={laps:'laps',stints:'stints',race_control:'raceControl',pit:'pits',position:'positions',intervals:'intervals'};
  for(const e of names){const file=`${key}-${e}.json`,raw=fs.readFileSync(path.join(dir,file));inputHashes[file]=crypto.createHash('sha256').update(raw).digest('hex');data[mapping[e]]=JSON.parse(raw).filter(r=>r.session_key===session.session_key);}
  const prepared=E.prepareSnapshotData(data);
  const cuts=new Map();for(const l of data.laps){const t=E.end(l);if(Number.isFinite(t)&&(!cuts.has(l.lap_number)||t<cuts.get(l.lap_number)))cuts.set(l.lap_number,t);}
  for(const [lap,cut] of [...cuts].sort((a,b)=>a[1]-b[1])){
   const snap=E.snapshot(prepared,cut,.035,5);r.cutoffs++;tally(r.control,snap.control.status);
   if(['RED','UNKNOWN','FINISHED','RESTART_UNCONFIRMED'].includes(snap.control.status)){tally(r.withheld,'track_status');continue;}
   const rows=snap.rows.filter(v=>v.recent&&v.pace&&v.age!==null&&v.gap!==null),reasons={};let example=null;
   if(rows.length<2){tally(r.withheld,'fewer_than_two_recent_fitted_drivers_with_gaps');continue;}
   for(let i=0;i<rows.length&&!example;i++)for(let j=i+1;j<rows.length&&!example;j++){
    const a=rows[i],b=rows[j],why=E.validPair(a,b);if(why){tally(reasons,why);continue;}
    for(const [stopA,stopB] of [[0,3],[3,0],[0,0]])if(E.simulatePair(a,b,inputs,stopA,stopB,snap.control.status)){example={lap,driverA:a.driver,driverB:b.driver,stopA,stopB,condition:snap.control.status};break;}
   }
   if(example){r.available++;if(r.examples.length<3)r.examples.push(example);}else tally(r.withheld,Object.keys(reasons).length?'gap_sync_or_age_support':'age_support');
  }
  results.push(r);console.log(JSON.stringify({done:results.length,total:sessions.length,session:r.sessionKey,available:r.available,cutoffs:r.cutoffs}));
 }
 const report={schema:1,asOf,cancelled:catalog.filter(s=>s.year>=2023&&s.year<=2026&&s.is_cancelled&&Date.parse(s.date_end)<Date.parse(asOf)).map(s=>({sessionKey:s.session_key,year:s.year,name:s.session_name,location:s.location})),engineHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist/race-engine.js'))).digest('hex'),inputs,protocol:'Every completed Race/Sprint session from the 2023–2026 catalog. At the earliest recorded lap completion for each lap number, freeze the full grid and test whether any two distinct drivers pass the existing recent-lap, stint-fit and actual-gap rules and support at least one default stop schedule (0:3,3:0,0:0), H=12, own current compound, recorded track condition. Check all pairs until a supported example is found. This is session/decision availability, not coverage of every driver pair or lap-time accuracy; an available scenario is not a validated strategy recommendation. No support gates are relaxed.',sessions:results,inputHashes};
 fs.writeFileSync(path.join(root,'dist/data/race-availability.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({complete:true,sessions:results.length,withScenario:results.filter(r=>r.available>0).length,cutoffs:results.reduce((n,r)=>n+r.cutoffs,0),available:results.reduce((n,r)=>n+r.available,0),errors:results.filter(r=>r.error).length}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
