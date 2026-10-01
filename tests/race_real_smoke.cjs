"use strict";
// Explicit opt-in: reads one real historical session; no LIVE token or subscription.
if(process.env.LAB_REAL_HISTORY!=="1"){console.log("Skipped: set LAB_REAL_HISTORY=1 to request historical OpenF1 data.");process.exit(0);}
const {chromium}=require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.LAB_BROWSER||"chrome"}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("response",r=>{if(r.url().startsWith("https://api.openf1.org/")&&!r.ok())console.log(JSON.stringify({request:r.url(),status:r.status()}));});
  try{
    await page.goto(process.env.LAB_URL||"http://127.0.0.1:4173/");
  await page.locator("#load-demo").click();await page.waitForFunction(()=>state.source==="demo");
    const loaded=await page.evaluate(async()=>{state.selectedMode="replay";state.replayYear=2023;state.sessionCatalog=[];await loadReplay({sessionKey:9126,force:true,skipCache:true});stopStreams();return {session:state.session?.session_key,error:state.replayError};});
    if(loaded.error||loaded.session!==9126)throw Error(JSON.stringify(loaded));
    await page.evaluate(()=>{setAnalysisTab("strategy");renderRaceReplay();});
    await page.locator("#race-cutoff").selectOption("25");
    await page.evaluate(()=>loadRaceSnapshot());
    const result=await page.evaluate(()=>({error:raceReplay.error,cutoff:raceReplay.snapshot?.cutoffISO,field:raceReplay.snapshot?.rows.length,completedLaps:raceReplay.snapshot?.completedLaps,control:raceReplay.snapshot?.control,hold:raceReplay.result?.reason,drivers:[raceReplay.result?.a,raceReplay.result?.b].map(r=>r?{driver:r.driver,position:r.position,gap:r.gap,gapAge:r.gapAge,age:r.age,n:r.pace?.n,slope:r.pace?.slope,nextPace:r.nextPace}:null),scenarios:raceReplay.result?.scenarios.map(s=>({id:s.id,afterBoth:s.afterBoth,range:s.rangeAtBoth})),rejoin:raceReplay.result?.rejoin}));
    if(result.error||!result.cutoff)throw Error(JSON.stringify(result));
    // Explicit counterfactual, never silently relabel UNKNOWN as observed GREEN.
    await page.locator("#race-control").selectOption("GREEN");
    const greenScenario=await page.evaluate(()=>({condition:raceReplay.result.condition,source:raceReplay.result.conditionSource,hold:raceReplay.result.reason,scenarios:raceReplay.result.scenarios.map(s=>({id:s.id,afterBoth:s.afterBoth,range:s.rangeAtBoth})),rejoin:raceReplay.result.rejoin}));
    if(greenScenario.hold||greenScenario.scenarios.length!==3)throw Error(JSON.stringify(greenScenario));
    await page.locator("#race-results").scrollIntoViewIfNeeded();await page.screenshot({path:require("node:path").join(process.env.TEMP||".","performance-lab-race-real.png")});
    await page.locator("#race-control").selectOption("observed");await page.locator("#race-cutoff").selectOption("35");await page.evaluate(()=>loadRaceSnapshot());
    const laterControl=await page.evaluate(()=>({cutoff:raceReplay.snapshot?.cutoffISO,control:raceReplay.snapshot?.control,hold:raceReplay.result?.reason,rankHold:raceReplay.result?.rankHold,error:raceReplay.error}));
    if(laterControl.error)throw Error(JSON.stringify(laterControl));
    console.log(JSON.stringify({result:"real historical request completed",...result,greenScenario,laterControl,errors},null,2));
    if(errors.length)throw Error(errors.join("; "));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
