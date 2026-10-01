// Final, bounded historical teaching fixture. Public OpenF1 data; no telemetry or credentials.
const fs=require('node:fs/promises');
const sessionKey=Number(process.argv[2]||9189),a=Number(process.argv[3]||1),b=Number(process.argv[4]||16),decisionLap=Number(process.argv[5]||45),filename=process.argv[6]||'race-demo.json';
async function read(endpoint,params={}) {
  const url=new URL('https://api.openf1.org/v1/'+endpoint);url.searchParams.set('session_key',String(sessionKey));Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  await new Promise(r=>setTimeout(r,2200));const response=await fetch(url);if(!response.ok)throw Error(endpoint+' '+response.status);return response.json();
}
(async()=>{
  const [session]=await read('sessions'),drivers=await read('drivers'),laps=await read('laps'),stints=await read('stints'),raceControl=await read('race_control'),pits=await read('pit'),weather=await read('weather');
  const lap=laps.find(l=>l.driver_number===a&&l.lap_number===decisionLap),cutoff=Date.parse(lap.date_start)+lap.lap_duration*1000;
  const positions=await read('position',{'date<':new Date(cutoff+1).toISOString()}),field=await read('intervals',{'date>':new Date(cutoff-20000).toISOString(),'date<':new Date(cutoff+1).toISOString()});
  const intervals=[...field,...await read('intervals',{driver_number:a}),...await read('intervals',{driver_number:b})];
  const data={session,drivers,laps,stints,raceControl,pits,weather,positions,intervals,cutoff,driverA:a,driverB:b,decisionLap,provenance:{source:'OpenF1',source_url:'https://openf1.org/docs/',session_key:sessionKey,selection:'Full timing/control, selected-driver interval histories and 20-second field gap window at declared cutoff. No future observations enter snapshots.',retrieved_at:new Date().toISOString(),limitations:'Public educational data, not team telemetry. Inferred SC restart is labelled. No outcome validation.'}};
  await fs.writeFile('dist/data/'+filename,JSON.stringify(data));console.log(JSON.stringify({session:sessionKey,cutoff:new Date(cutoff).toISOString(),laps:laps.length,control:raceControl.length,weather:weather.length}));
})().catch(e=>{console.error(e);process.exitCode=1;});
