"use strict";
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.LAB_BROWSER||"chrome"});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.testModelTools={};
    Object.defineProperty(document,"modelContext",{value:{registerTool(tool){window.testModelTools[tool.name]=tool;}}});
  });
  try {
    await page.goto(process.env.LAB_URL||"http://127.0.0.1:4173/");
  await page.locator("#load-demo").click();
    await page.waitForFunction(()=>state.source==="demo"&&linkedTraceActive());
    assert.equal(await page.locator("#distance-delta-chart").count(),0);
    assert.equal(await page.locator(".distance-delta-path").count(),1);
    await page.evaluate(()=>{stopStreams();setProgressWindow(.3,.5);state.cursorProgress=.4;state.replayCursor=10;render();});
    const snapshot=await page.evaluate(()=>window.testModelTools.read_telemetry_snapshot.execute());
    assert.equal(snapshot.cursor.axis,"estimated_progress");assert.equal(snapshot.cursor.value,.4);
    assert.equal(snapshot.driver_a.sample.speed_kmh,Number(await page.locator("#speed-value-a").textContent()));
    assert.equal(snapshot.driver_b.sample.speed_kmh,Number(await page.locator("#speed-value-b").textContent()));
    assert.notEqual(snapshot.driver_a.sample.lap_relative_time_seconds,10);
    // A race fixture makes the scenario visible; no external API is involved.
    await page.evaluate(()=>{
      state.source="openf1";state.session.session_name="Race";state.session.session_type="Race";
      const start=Date.parse(state.session.date_start);
      state.sessionContext={stints:[4,81].map(driver=>({driver_number:driver,stint_number:1,compound:"SOFT",lap_start:1,lap_end:6,tyre_age_at_start:0})),pits:[],weather:[],raceControl:[],intervals:new Map(),intervalAvailability:new Map()};
      state.laps=[4,81].flatMap(driver=>Array.from({length:6},(_,i)=>({driver_number:driver,lap_number:i+1,lap_duration:90+(driver===81?.3:0)+i*.045,date_start:new Date(start+i*100000).toISOString()})));
      setAnalysisTab("strategy");buildPaceRows();
    });
    await page.locator("#strategy-horizon").fill("3");await page.locator("#strategy-delay").fill("29");
    assert.equal(await page.locator("#strategy-delay").inputValue(),"2");
    assert.match(await page.locator("#strategy-detail-a").textContent(),/\+2 laps \/ 3-lap/);
    const queried=await page.evaluate(()=>window.testModelTools.read_performance_analysis.execute());
    assert.equal(queried.strategy_assumptions.delay,2);
    await page.locator("#strategy-fuel-gain").fill("");
    assert.equal(await page.evaluate(()=>modelFuelGain()),.035);
    assert.equal(await page.evaluate(()=>strategyInputs().fuelGain),.035);
    await page.locator("#strategy-fuel-gain").blur();assert.equal(await page.locator("#strategy-fuel-gain").inputValue(),"0.035");
    await page.locator("#strategy-fuel-gain").fill("0");assert.equal(await page.evaluate(()=>modelFuelGain()),0);
    const downloadEvent=page.waitForEvent("download");await page.locator("#export-json").click();
    const download=await downloadEvent,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
    const exported=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(exported.assumptions.delay,2);assert.equal(exported.assumptions.fuelGain,0);assert.equal(exported.display.cursor.value,.4);
    assert.equal(exported.display.driver_a.sample.speed_kmh,Number(await page.locator("#speed-value-a").textContent()));
    // All channels can be unavailable without becoming physical zero / OFF.
    const missing=await page.evaluate(()=>{
      const data=normalizeLiveTelemetry({date:"2026-01-01T00:00:00Z",speed:null,throttle:null,brake:null,rpm:null,n_gear:null});
      updateReadout("a",data);
      state.mode="live";state.traceAxis="time";state.telemetry=new Map([[4,[data]],[81,[data]]]);
      state.hoverTime=null;
      return telemetrySnapshot();
    });
    assert.equal(await page.locator("#speed-value-a").textContent(),"—");assert.equal(await page.locator("#brake-a").textContent(),"—");
    assert.equal(missing.driver_a.sample.speed_kmh,null);assert.equal(missing.driver_a.sample.brake_on,null);
    await page.locator("#load-demo").click();await page.waitForFunction(()=>state.source==="demo");
    await page.locator("#tab-distance").click();assert.equal(await page.locator("#tab-distance").textContent(),"ALIGNMENT CHECK");
    await page.locator("#open-linked-traces").click();assert.ok(await page.locator("#linked-delta-chart").isVisible());
    assert.equal(await page.locator("#language-toggle").count(), 0);assert.equal(await page.locator("#tab-distance").textContent(),"ALIGNMENT CHECK");
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:"UI/export/query contract checks passed",snapshot: snapshot.cursor,delay:exported.assumptions.delay,fuel:exported.assumptions.fuelGain,errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
