"use strict";
const assert=require("node:assert/strict"),{chromium}=require("playwright"),{fixture}=require("./race_fixtures.cjs");
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.LAB_BROWSER||"chrome"}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>{window.raceTools={};Object.defineProperty(document,"modelContext",{value:{registerTool(t){window.raceTools[t.name]=t;}}});});
  try{
    const f=fixture();
    await page.route("https://api.openf1.org/v1/**",async route=>{const u=new URL(route.request().url());requests.push(u);const endpoint=u.pathname.split("/").pop();const result=endpoint==="position"?f.data.positions:endpoint==="intervals"?f.data.intervals:[];await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});});
    await page.goto(process.env.LAB_URL||"http://127.0.0.1:4173/");
  await page.locator("#load-demo").click();await page.waitForFunction(()=>state.source==="demo");
    await page.locator("#tab-strategy").click();assert.equal(await page.locator("#race-load").isEnabled(),false);
    await page.evaluate(f=>{
      stopStreams();state.selectedMode="replay";state.source="openf1";state.mode="replay";state.selectedA=4;state.selectedB=81;state.session={session_key:777,session_name:"Race",session_type:"Race",year:2023,date_start:f.data.raceControl[0].date,location:"Synthetic implementation test"};state.drivers=f.data.drivers;state.laps=f.data.laps;
      state.sessionContext={sessionKey:777,stints:f.data.stints,pits:[],weather:[],raceControl:f.data.raceControl,intervals:new Map([[4,f.data.intervals.filter(i=>i.driver_number===4)],[81,f.data.intervals.filter(i=>i.driver_number===81)]]),intervalAvailability:new Map()};updateLabDetails();renderRaceReplay();
    },f);
    await page.locator("#race-cutoff").selectOption("12");await page.locator("#race-load").click();await page.waitForFunction(()=>!!raceReplay.result&&!raceReplay.loading);
    assert.equal(requests.length,2);assert.equal(raceEndpoint(requests[0]),"position");assert.equal(raceEndpoint(requests[1]),"intervals");assert.ok(requests[1].searchParams.has("date>"));assert.ok(requests[1].searchParams.has("date<"));assert.equal(requests[1].searchParams.has("date<="),false);
    assert.equal(await page.evaluate(()=>raceReplay.snapshot.rows[0].age),12);
    assert.equal(await page.evaluate(()=>raceReplay.result.reason),null);
    assert.ok(await page.locator(".race-gap-figure").isVisible());
    await page.locator("#strategy-delay").fill("4");assert.equal(await page.evaluate(()=>raceReplay.result.inputs.delay),4);assert.equal(requests.length,2);
    await page.locator("#race-neutral-laps").fill("12");await page.locator("#strategy-horizon").fill("6");assert.equal(await page.locator("#race-neutral-laps").inputValue(),"6");assert.equal(await page.evaluate(()=>raceReplay.result.inputs.neutralLaps),6);await page.locator("#strategy-horizon").fill("12");await page.locator("#race-neutral-laps").fill("2");
    await page.locator("#race-control").selectOption("SC");assert.equal(await page.evaluate(()=>raceReplay.result.rejoin),null);assert.match(await page.locator("#race-results").textContent(),/withheld/);
    await page.locator("#race-control").selectOption("GREEN");
    const queried=await page.evaluate(()=>window.raceTools.read_race_scenario.execute());assert.equal(queried.scenario.inputs.delay,4);
    const dl=page.waitForEvent("download");await page.locator("#race-export").click();const stream=await(await dl).createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);const exported=JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(exported,queried);assert.ok(exported.observations.laps.every(l=>Date.parse(l.date_start)+l.lap_duration*1000<=exported.snapshot.cutoff));
    await page.locator("#race-load").click();await page.waitForFunction(()=>!raceReplay.loading);assert.equal(requests.length,2,"Cached snapshot must not repeat API calls");
    assert.equal(await page.locator("#language-toggle").count(), 0);assert.match(await page.locator("#race-title").textContent(),/Race/i);
    await page.screenshot({path:require("node:path").join(process.env.TEMP||".","performance-lab-race-desktop.png"),fullPage:false});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.locator("#race-replay").scrollIntoViewIfNeeded();await page.screenshot({path:require("node:path").join(process.env.TEMP||".","performance-lab-race-mobile.png")});
    await page.locator("#race-cutoff").selectOption("8");assert.equal(await page.locator("#race-export").isEnabled(),false);assert.equal(await page.evaluate(()=>raceReplay.result),null);
    await page.locator("#load-demo").click();await page.waitForFunction(()=>state.source==="demo");assert.equal(await page.locator("#race-load").isEnabled(),false);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({result:"historical race browser checks passed",requests:requests.length,exportCutoff:exported.snapshot.cutoffISO,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
function raceEndpoint(u){return u.pathname.split("/").pop();}
