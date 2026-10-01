"use strict";
// Raw public source cache, not analysis iterations. Serial requests with backoff.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.sites-runtime/openf1-full');
fs.mkdirSync(dir,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function read(endpoint,params,file){
  const dest=path.join(dir,file);if(fs.existsSync(dest))return JSON.parse(fs.readFileSync(dest,'utf8'));
  const u=new URL('https://api.openf1.org/v1/'+endpoint);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  for(let attempt=0;attempt<4;attempt++){
    await sleep(800);
    try{
      const r=await fetch(u,{signal:AbortSignal.timeout(90000)});
      if(r.status===429||r.status>=500){await sleep(Math.max(5000*(attempt+1),Number(r.headers.get('retry-after')||0)*1000));continue;}
      if(!r.ok&&r.status!==404)throw Error('HTTP '+r.status);
      const data=r.status===404?[]:await r.json();if(!Array.isArray(data))throw Error('Expected an array');
      fs.writeFileSync(dest,JSON.stringify(data));return data;
    }catch(e){if(attempt===3)throw e;await sleep(3000*(attempt+1));}
  }
  throw Error('Retries exhausted');
}
async function main(){
  const sessions=await read('sessions',{},'sessions.json'),asOf=new Date().toISOString();
  const selected=sessions.filter(s=>s.year>=2023&&s.year<=2026&&Date.parse(s.date_end)<Date.parse(asOf));
  const meetings=[...new Set(selected.filter(s=>!s.is_cancelled).map(s=>s.meeting_key))];
  console.log(JSON.stringify({asOf,sessions:selected.length,years:Object.fromEntries([2023,2024,2025,2026].map(y=>[y,selected.filter(s=>s.year===y).length])),meetings:meetings.length}));
  const errors=[];
  for(let i=0;i<meetings.length;i++){
    const key=meetings[i];
    for(const endpoint of ['laps','stints','race_control','pit']){
      try{await read(endpoint,{meeting_key:key},`${key}-${endpoint}.json`);}
      catch(e){errors.push({meeting_key:key,endpoint,error:e.message});console.log(JSON.stringify(errors.at(-1)));}
    }
    console.log(`Downloaded ${i+1}/${meetings.length} meetings: ${key}`);
  }
  fs.writeFileSync(path.join(dir,'collection.json'),JSON.stringify({asOf,sessions:selected,errors},null,2));
  console.log(JSON.stringify({complete:true,errors:errors.length}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={read,dir};
