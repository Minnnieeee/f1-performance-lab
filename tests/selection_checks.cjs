const assert=require('node:assert/strict'),{chromium}=require('playwright');
const demo=require('../dist/data/demo.json');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(process.env.LAB_URL||'http://127.0.0.1:4173');
  await page.locator("#load-demo").click();
  await page.waitForFunction(()=>state.source==='demo'&&raceReplay.result);
  await page.locator('#tab-strategy').click();
  assert.equal(await page.locator('#race-demo-case option').count(),5);
  assert.match(await page.locator('#race-result-head').textContent(),/A stops now/);
  const before=await page.locator('#race-result-head').textContent();
  await page.locator('#strategy-delay').fill('2');await page.locator('#strategy-delay').press('Tab');
  await page.waitForFunction(()=>raceReplay.result.inputs.delay===2);
  assert.notEqual(await page.locator('#race-result-head').textContent(),before);
  await page.locator('#strategy-delay').fill('3');await page.locator('#strategy-delay').press('Tab');
  await page.evaluate(()=>{state.selectedMode='replay';state.session={...state.session,session_type:'Practice',session_name:'Practice 1',year:2026};renderRaceReplay();});
  const reports=[];
  for(const key of ['9189','9157','9165','9213']){
   await page.locator('#race-demo-case').selectOption(key);
   await page.waitForFunction(key=>raceSession()?.session_key===Number(key)&&!!raceReplay.result,key);
   assert.equal(await page.locator('#race-cutoff').isEnabled(),true);
   assert.ok((await page.locator('#race-results').textContent()).length>1000);
   reports.push(await page.evaluate(()=>({key:raceSource,lap:document.getElementById('race-cutoff').value,reason:raceReplay.result.reason,usable:raceReplay.result.scenarios.filter(s=>!s.unavailable).length})));
  }
  await page.locator('#race-cutoff').selectOption('31');await page.waitForFunction(()=>raceReplay.snapshot&&Number(document.getElementById('race-cutoff').value)===31&&raceReplay.key===raceRequestKey());
  await page.locator('#race-assumptions-section > summary').click();
  await page.locator('#race-control').selectOption('SC');await page.waitForFunction(()=>raceReplay.result.condition==='SC');
  const saving=await page.evaluate(()=>raceReplay.result.savings.SC);
  await page.locator('#strategy-pit-loss').fill('30');await page.locator('#strategy-pit-loss').press('Tab');await page.waitForFunction(()=>raceReplay.result.savings.SC===18);
  assert.notEqual(saving,18);
  // Actual loadReplay flow, with deterministic API payloads and native lap data.
  const contextCheck=await page.evaluate(async demo=>{
   stopStreams();state.selectedMode='replay';state.mode='replay';state.source='demo';state.sessionCatalog=[{...demo.session,session_key:11362,session_name:'Practice 1',session_type:'Practice',year:2026}];
   const calls=[],originalApi=apiFetch,originalLap=fetchLapDataset;
   apiFetch=async endpoint=>{calls.push(endpoint);if(endpoint==='drivers')return demo.drivers;if(endpoint==='laps')return demo.datasets.map(d=>d.lap);if(endpoint==='stints')return demo.stints.map(s=>({...s,tyre_age_at_start:0}));throw Error('Unexpected endpoint '+endpoint);};
   fetchLapDataset=async(driver,lap)=>{const d=demo.datasets.find(d=>d.lap.driver_number===driver&&d.lap.lap_number===lap.lap_number);return {telemetry:d.telemetry,locations:d.locations};};
   try{await loadReplay({sessionKey:11362,driverA:4,driverB:81});return {calls,error:state.replayError,stints:state.stints.length,fullContext:state.sessionContext,text:document.getElementById('lap-context-a').textContent};}
   finally{apiFetch=originalApi;fetchLapDataset=originalLap;stopStreams();}
  },demo);
  assert.equal(contextCheck.error,null);assert.ok(contextCheck.stints>0);assert.equal(contextCheck.fullContext,null);
  assert.ok(contextCheck.calls.includes('stints'));assert.match(contextCheck.text,/SOFT/);assert.match(contextCheck.text,/total set usage unverified/);assert.doesNotMatch(contextCheck.text,/UNKNOWN|\?/);assert.match(contextCheck.text,/not provided for practice/);
  assert.equal(await page.locator("#language-toggle").count(), 0);
  assert.match(await page.locator('#lap-context-a').textContent(),/total set usage unverified/);
  assert.equal(await page.locator('#strategy-horizon').isVisible(),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.locator('#race-demo-case').scrollIntoViewIfNeeded();
  await page.screenshot({path:process.env.TEMP+'/f1-selection-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});await page.locator('#race-demo-case').scrollIntoViewIfNeeded();
  await page.screenshot({path:process.env.TEMP+'/f1-selection-desktop.png'});
  const f=require('./race_fixtures.cjs').fixture();
  await page.route('https://api.openf1.org/v1/**',async route=>{
   const endpoint=new URL(route.request().url()).pathname.split('/').pop();
   await route.fulfill({contentType:'application/json',body:JSON.stringify(endpoint==='position'?f.data.positions:endpoint==='intervals'?f.data.intervals:[])});
  });
  await page.evaluate(f=>{
   state.selectedMode='replay';state.mode='replay';state.source='openf1';state.selectedA=4;state.selectedB=81;
   state.session={session_key:777,session_name:'Race',session_type:'Race',year:2023,date_start:f.data.raceControl[0].date,location:'Synthetic test'};
   state.drivers=f.data.drivers;state.laps=f.data.laps;
   state.sessionContext={sessionKey:777,stints:f.data.stints,pits:[],weather:[],raceControl:f.data.raceControl,intervals:new Map([[4,f.data.intervals.filter(i=>i.driver_number===4)],[81,f.data.intervals.filter(i=>i.driver_number===81)]]),intervalAvailability:new Map()};renderRaceReplay();
  },f);
  await page.locator('#race-demo-case').selectOption('current');
  await page.waitForFunction(()=>raceSource==='current'&&raceReplay.result&&!raceReplay.loading);
  await page.locator('#race-cutoff').selectOption('12');
  await page.waitForFunction(()=>raceReplay.result&&!raceReplay.loading&&raceReplay.key.endsWith(':12'));
  assert.equal(await page.evaluate(()=>raceReplay.result.reason),null);
  const exported=await page.evaluate(()=>raceExportPayload());
  assert.equal(exported.session.session_key,777);assert.equal(exported.scenario.inputs.pitLoss,30);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,contextCheck,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
