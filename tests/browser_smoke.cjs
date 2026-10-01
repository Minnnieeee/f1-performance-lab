"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.LAB_BROWSER || "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [], requests = [];
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../dist/data/demo.json"), "utf8"));
  await page.addInitScript(() => localStorage.setItem("performance-lab-language", "ko"));
  let apiMode = "denied";
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://api.openf1.org/**", async (route) => {
    const url = new URL(route.request().url()); requests.push(url.toString());
    if (apiMode === "network") return route.abort("failed");
    const options = { contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" } };
    if (apiMode === "denied") return route.fulfill({ ...options, status:401, body:'{"detail":"Test access restriction"}' });
    if (apiMode === "slow") { await new Promise(resolve => setTimeout(resolve, 500)); return route.fulfill({ ...options, status:401, body:'{}' }).catch(() => {}); }
    // A known frozen fixture exercises successful replay plumbing; it is not
    // evidence of real OpenF1 availability or an authenticated LIVE test.
    const endpoint = url.pathname.split("/").at(-1);
    const dataset = fixture.datasets.find(d => Number(d.lap.driver_number) === Number(url.searchParams.get("driver_number")) && d.lap.lap_number === 25);
    const response = endpoint === "sessions" ? [fixture.session] : endpoint === "drivers" ? fixture.drivers : endpoint === "laps" ? fixture.datasets.filter(d => d.lap.lap_number === 25).map(d => d.lap) : endpoint === "car_data" ? dataset.telemetry : endpoint === "location" ? dataset.locations : [];
    return route.fulfill({ ...options, status:200, body:JSON.stringify(response) });
  });
  try {
    await page.goto(process.env.LAB_URL || "http://127.0.0.1:4173/");
  await page.locator("#load-demo").click();
  requests.length = 0;
    await page.waitForFunction(() => state.source === "demo" && state.distanceAnalysis);
    assert.equal(requests.length, 0, "DEMO must not request OpenF1");
    assert.equal(await page.locator("#reload-replay").count(), 0, "Session selection loads automatically without a separate button");
    assert.equal(await page.locator("#replay-year").isVisible(), false);
    assert.match(await page.locator("#session-name").textContent(), /2023/);
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator("#distance-finish-delta").textContent(), "-0.131");
    assert.equal(await page.locator("#lap-a option").count(), 2);
    assert.equal(await page.locator("#lap-b option").count(), 2);
    assert.match(await page.locator("#lap-context-a").textContent(), /age at lap start 1/);
    const diagnostics = await page.evaluate(() => ({ quality: [state.distanceAnalysis.lapA.quality, state.distanceAnalysis.lapB.quality], sectors: sectorChecks(), zones: state.distanceAnalysis.corners.length }));
    assert.equal(diagnostics.sectors[2].localDelta, null, "Missing finish sample is not a measured boundary");
    assert.ok((await page.locator("#speed-a").getAttribute("d")).length > 100);
    await page.screenshot({ path: path.join(process.env.TEMP || ".", "performance-lab-desktop.png") });
    for (const tab of ["distance", "corners", "stints", "strategy", "model", "case"]) {
      await page.locator("#tab-" + tab).click();
      assert.ok(await page.locator("#panel-" + tab).isVisible());
    }
    assert.match(await page.locator("#case-content").textContent(), /S1, -0.090s/);
    await page.locator("#tab-strategy").click();
    assert.equal(await page.locator("#strategy-result-a").textContent(), "—");
    assert.match(await page.locator("#strategy-detail-a").textContent(), /qualifying/);
    await page.locator("#strategy-pit-loss").fill("30");
    assert.match(await page.locator("#sc-saving").textContent(), /12.0/);
    await page.locator("#lap-a").selectOption("22");
    assert.equal(await page.locator("#distance-finish-delta").textContent(), "+1.322");
    assert.match(await page.locator("#comparison-warning").textContent(), /WARNING/);
    await page.locator("#lap-a").selectOption("25");
    assert.equal(await page.locator("#language-toggle").count(), 0);
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.match(await page.locator("#case-content").textContent(), /Engineering/i);
    assert.match(await page.locator("#panel-strategy").textContent(), /cancel/);
    assert.equal(await page.locator("#language-toggle").count(), 0);
    await page.locator("#tab-distance").click();
    await page.locator("#open-linked-traces").click();
    await page.locator("#linked-delta-chart").scrollIntoViewIfNeeded();
    const bounds = await page.locator("#linked-delta-chart").boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    assert.ok(await page.locator("#linked-delta-tooltip").isVisible());
    assert.match(await page.locator("#linked-delta-tooltip").textContent(), /X 50.0%/);
    for (const format of ["json", "csv"]) {
      const event = page.waitForEvent("download");
      await page.locator("#export-" + format).click();
      const download = await event;
      assert.match(download.suggestedFilename(), new RegExp("\\." + format + "$"));
    }
    await page.locator("#tab-case").click();
    await page.locator(".analysis-lab").screenshot({ path: path.join(process.env.TEMP || ".", "performance-lab-case.png") });
    await page.locator('[data-mode="live"]').click();
    await page.locator("#connect-live").click();
    assert.equal(requests.length, 0, "No live request without a token");
    assert.match(await page.locator("#toast").textContent(), /paid OpenF1/);
    await page.locator('[data-mode="replay"]').click();
    await page.waitForFunction(() => state.replayError?.code === "access" && !state.replayLoading);
    assert.equal(await page.locator('[data-mode="replay"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#load-demo").getAttribute("aria-pressed"), "false");
    assert.match(await page.locator("#replay-feedback-detail").textContent(), /HTTP 401/);
    assert.equal(await page.locator("#replay-year").inputValue(), "2026", "DEMO does not silently change the replay year");
    assert.ok(requests.length > 0);
    apiMode = "network";
    await page.locator("#replay-year").selectOption("2025");
    await page.waitForFunction(() => state.replayError?.code === "network" && !state.replayLoading);
    assert.equal(await page.locator('[data-mode="replay"]').getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("#replay-feedback-detail").textContent(), /network \/ CORS/);
    assert.equal(await page.locator("#replay-session").inputValue(), "");
    assert.equal(await page.locator("#driver-a").isEnabled(), false);
    assert.equal(await page.locator("#language-toggle").count(), 0);
    assert.match(await page.locator("#replay-feedback-detail").textContent(), /network \/ CORS/);
    assert.equal(await page.locator("#language-toggle").count(), 0);
    // Restoring real-looking replay data is tested without depending on the
    // upstream service. Failures after success retain that labelled data.
    apiMode = "success";
    await page.locator("#replay-year").selectOption("2023");
    await page.waitForFunction(() => state.source === "openf1" && !state.replayLoading);
    assert.equal(await page.locator("#distance-finish-delta").textContent(), "-0.131");
    assert.equal(await page.locator("#replay-feedback").isVisible(), false);
    assert.equal(await page.locator("#driver-a").isEnabled(), true);
    apiMode = "network";
    await page.locator("#replay-year").selectOption("2024");
    await page.waitForFunction(() => state.replayError?.code === "network" && !state.replayLoading);
    assert.equal(await page.locator("#distance-finish-delta").textContent(), "-0.131");
    assert.match(await page.locator("#replay-feedback-detail").textContent(), /last successful load: Silverstone/);
    await page.locator("#error-open-demo").click();
    await page.waitForFunction(() => state.source === "demo" && document.getElementById("access-note").textContent.startsWith("DEMO:"));
    const beforeDemoLap = requests.length;
    await page.locator("#lap-a").selectOption("22");
    assert.equal(requests.length, beforeDemoLap);
    await page.locator("#lap-a").selectOption("25");
    // A delayed response must never override a later explicit DEMO selection.
    apiMode = "slow";
    await page.locator('[data-mode="replay"]').click();
    await page.waitForFunction(() => state.replayLoading);
    await page.locator("#load-demo").click();
    await page.waitForFunction(() => state.source === "demo" && !state.replayLoading);
    await page.waitForTimeout(700);
    assert.equal(await page.locator("#load-demo").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#replay-feedback").isVisible(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(process.env.TEMP || ".", "performance-lab-mobile.png") });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    assert.equal(overflow, false, "No page-level horizontal overflow on mobile");
    assert.deepEqual(errors, []);
    const koreanInEnglish = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), found = [];
      while(walker.nextNode()) { const node = walker.currentNode; if (!['SCRIPT','STYLE'].includes(node.parentElement?.tagName) && /[가-힣]/.test(node.textContent)) found.push(node.textContent.trim()); }
      return found;
    });
    assert.deepEqual(koreanInEnglish, [], "English mode must not leave Korean explanations behind");
    console.log(JSON.stringify({ result: "browser smoke passed", diagnostics, errors }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
