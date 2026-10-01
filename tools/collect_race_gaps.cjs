"use strict";
const fs=require('node:fs'),path=require('node:path'),{read,dir}=require('./collect_sessions.cjs');
(async()=>{
 const catalog=JSON.parse(fs.readFileSync(path.join(dir,'sessions.json'))),now=Date.now();
 const meetings=[...new Set(catalog.filter(s=>s.year>=2023&&s.year<=2026&&Date.parse(s.date_end)<now&&!s.is_cancelled&&/Race/i.test(s.session_type)).map(s=>s.meeting_key))],errors=[];
 for(let i=0;i<meetings.length;i++){
  const key=meetings[i];
  for(const endpoint of ['intervals','position'])try{await read(endpoint,{meeting_key:key},`${key}-${endpoint}.json`);}catch(e){errors.push({meeting_key:key,endpoint,error:e.message});console.log(JSON.stringify(errors.at(-1)));}
  console.log(`Race gap records ${i+1}/${meetings.length}: ${key}`);
 }
 fs.writeFileSync(path.join(dir,'gap-collection.json'),JSON.stringify({asOf:new Date().toISOString(),meetings,errors},null,2));
 console.log(JSON.stringify({complete:true,errors}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
