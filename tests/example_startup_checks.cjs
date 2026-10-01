"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const app = fs.readFileSync(require.resolve("../dist/app.js"), "utf8");
const lab = fs.readFileSync(require.resolve("../dist/lab.js"), "utf8");
const demo = require("../dist/data/demo.json");
function fixture(fetch) {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { style: {}, value: "", textContent: "" });
    return elements.get(id);
  } };
  const ctx = vm.createContext({ console, document, fetch, setTimeout, clearTimeout, cancelAnimationFrame() {}, localStorage: { removeItem() {} } });
  const run = code => vm.runInContext(code, ctx);
  run(app.slice(0, app.indexOf('document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener')));
  run(lab.slice(0, lab.indexOf('$("load-demo").addEventListener')));
  // Isolate data selection and async cancellation from DOM/plot rendering.
  run(`syncModeControls=updateSessionOptions=updateDriverOptions=updateLapSelectors=
    buildDistancePerformanceAnalysis=buildPaceRows=updateLabDetails=render=resetReplayClock=clearChartHover=()=>{};
    setStatus=(kind,label)=>{$("connection-label").textContent=label;};
    loadReplay=()=>{throw Error("Startup must not request OpenF1");};`);
  return { run, start: () => run(lab.slice(lab.indexOf("// Retire the previous language preference"))) };
}
(async () => {
  const calls = [];
  const f = fixture(async url => { calls.push(url); return { ok: true, json: async () => demo }; });
  await f.start();
  assert.deepEqual(calls, ["./data/demo.json"]);
  assert.equal(f.run("state.selectedMode"), "demo");
  assert.equal(f.run("state.selectedA"), 4);
  assert.equal(f.run("state.selectedB"), 81);
  assert.deepEqual(Array.from(f.run("[...state.replayData.values()].map(d=>d.lap.lap_number)")), [25,25]);
  assert.equal(f.run("state.session.year"), 2023);
  assert.equal(f.run("state.token"), "");
  assert.deepEqual(Array.from(f.run("state.progressWindow")), [0,1]);
  let complete;
  const pending = fixture(() => new Promise(resolve => { complete = resolve; }));
  const loading = pending.start();
  pending.run('stopStreams();state.selectedMode="replay";');
  complete({ ok: true, json: async () => demo });
  await loading;
  assert.equal(pending.run("state.selectedMode"), "replay");
  assert.equal(pending.run("state.session"), null);
  const failed = fixture(async () => { throw Error("Example request failed"); });
  await failed.start();
  assert.match(failed.run('$("connection-label").textContent'), /Example unavailable/);
  assert.equal(failed.run("state.replayData.size"), 0);
  console.log("Example startup passed: exact NOR/PIA L25 pair, bundled-only request, full-lap view, cancellation and visible failure.");
})().catch(error => { console.error(error); process.exitCode = 1; });
