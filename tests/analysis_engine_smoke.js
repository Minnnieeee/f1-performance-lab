"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appPath = path.join(__dirname, "..", "dist", "app.js");
const source = fs.readFileSync(appPath, "utf8");
const eventBindingMarker = 'document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener';
const cutoff = source.indexOf(eventBindingMarker);
assert.ok(cutoff > 0, "Could not isolate the analysis engine from browser event bindings.");

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      textContent: "",
      innerHTML: "",
      value: "",
      disabled: false,
      style: {},
      className: "",
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      closest() { return this; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 260 }; },
    });
  }
  return elements.get(id);
}

const context = vm.createContext({
  console,
  Date,
  Intl,
  Math,
  Map,
  Set,
  URL,
  performance,
  setTimeout,
  clearTimeout,
  document: {
    getElementById: element,
    querySelectorAll() { return []; },
  },
});
vm.runInContext(source.slice(0, cutoff), context, { filename: appPath });

function syntheticLap(driver, duration, phaseOffset = 0) {
  const samples = 420;
  const start = Date.parse("2026-09-06T13:00:00Z");
  const telemetry = [];
  const locations = [];
  for (let index = 0; index < samples; index += 1) {
    const progress = index / (samples - 1);
    const angle = progress * Math.PI * 2;
    const t = progress * duration;
    const cornerDip = [0.18, 0.46, 0.73].reduce((sum, center) => (
      sum + 105 * Math.exp(-((progress - center) ** 2) / 0.0005)
    ), 0);
    locations.push({ t, x: 1400 * Math.cos(angle), y: 900 * Math.sin(angle) });
    telemetry.push({ t, speed: 305 - cornerDip + phaseOffset, throttle: 100, brake: 0, n_gear: 8, rpm: 11000 });
  }
  return {
    lap: { driver_number: driver, lap_number: 1, lap_duration: duration, date_start: new Date(start).toISOString() },
    telemetry,
    locations,
  };
}

context.dataA = syntheticLap(1, 90.0);
context.dataB = syntheticLap(2, 91.2, -2);
vm.runInContext(`
  state.mode = "replay";
  state.source = "openf1";
  state.session = { session_key: 1, session_name: "Qualifying", session_type: "Qualifying", location: "Test Circuit", date_start: "2026-09-06T13:00:00Z" };
  state.drivers = [
    { driver_number: 1, name_acronym: "AAA", full_name: "Driver A", team_name: "Team A" },
    { driver_number: 2, name_acronym: "BBB", full_name: "Driver B", team_name: "Team B" },
  ];
  state.selectedA = 1;
  state.selectedB = 2;
  state.replayData = new Map([[1, dataA], [2, dataB]]);
  buildDistancePerformanceAnalysis();
`, context);

const distanceResult = vm.runInContext(`({
  grid: state.distanceAnalysis.grid.length,
  corners: state.distanceAnalysis.corners.length,
  finishDelta: state.distanceAnalysis.finishDelta,
})`, context);
assert.equal(distanceResult.grid, 251);
assert.ok(distanceResult.corners >= 3, `Expected at least three detected corners, received ${distanceResult.corners}.`);
assert.ok(Math.abs(distanceResult.finishDelta + 1.2) < 1e-9);

element("strategy-fuel-gain").value = "0.035";
element("strategy-horizon").value = "12";
element("strategy-pit-loss").value = "22";
element("strategy-sc-factor").value = "0.60";
element("strategy-vsc-factor").value = "0.75";

context.syntheticLaps = [];
for (const driver of [1, 2]) {
  for (let lap = 1; lap <= 10; lap += 1) {
    const tyreAge = lap - 1;
    const baseline = driver === 1 ? 90 : 90.4;
    context.syntheticLaps.push({
      driver_number: driver,
      lap_number: lap,
      lap_duration: baseline + 0.08 * tyreAge - 0.035 * tyreAge,
      date_start: new Date(Date.parse("2026-09-06T13:00:00Z") + (lap - 1) * 91_000).toISOString(),
      is_pit_out_lap: false,
    });
  }
}
context.syntheticStints = [1, 2].map((driver) => ({
  driver_number: driver,
  stint_number: 1,
  compound: "MEDIUM",
  lap_start: 1,
  lap_end: 10,
  tyre_age_at_start: 0,
}));

vm.runInContext(`
  state.session = { session_key: 2, session_name: "Race", session_type: "Race", location: "Test Circuit", date_start: "2026-09-06T13:00:00Z" };
  state.laps = syntheticLaps;
  state.sessionContext = {
    sessionKey: 2,
    stints: syntheticStints,
    pits: [],
    raceControl: [],
    weather: [],
    intervals: new Map(),
    intervalAvailability: new Map(),
    trackModel: null,
  };
  buildPaceRows();
`, context);

const paceResult = vm.runInContext(`({
  rowCount: state.paceRows.length,
  degradation: state.paceRows.map((row) => row.degradation),
  trackReason: state.sessionContext.trackModel.reason,
})`, context);
assert.equal(paceResult.rowCount, 2);
paceResult.degradation.forEach((value) => assert.ok(Math.abs(value - 0.08) < 1e-9));
assert.equal(paceResult.trackReason, "race_confounding");

// Changed timing and scenario semantics: no hidden endpoint fitting, no
// invented zero values, and common costs must cancel in the comparison.
const frozen = JSON.parse(fs.readFileSync(path.join(__dirname, "../dist/data/demo.json"), "utf8"));
context.frozen = frozen;
const frozenResult = vm.runInContext(`(() => {
  state.source = "demo";
  state.session = frozen.session;
  state.drivers = frozen.drivers;
  state.selectedA = 4; state.selectedB = 81;
  const a = frozen.datasets.find(d => d.lap.driver_number === 4 && d.lap.lap_number === 25);
  const b = frozen.datasets.find(d => d.lap.driver_number === 81 && d.lap.lap_number === 25);
  state.replayData = new Map([[4,a], [81,b]]);
  buildDistancePerformanceAnalysis();
  const result = state.distanceAnalysis;
  const broken = { ...a, locations: a.locations.filter(p => p.t < 10 || p.t > 25) };
  const extended = { ...a, locations: [...a.locations, {t:a.lap.lap_duration+0.4,x:1,y:1}] };
  const row = { basePace: 90, degradation: 0.08, currentAge: 8 };
  const assumptions = { horizon:12,delay:2,pitLoss:22,fuelGain:0.035,warmup:0.6 };
  const difference = inputs => simulateStop(row,inputs,2)-simulateStop(row,inputs,0);
  return {
    finish: result.finishDelta,
    sectorDeltas: [1,2,3].map(i => a.lap['duration_sector_'+i]-b.lap['duration_sector_'+i]),
    timestampsPreserved: result.lapA.path.every(p => a.locations.some(raw => raw.t === p.t)),
    lastTime: result.lapA.path.at(-1).t,
    duration: a.lap.lap_duration,
    badCoverageHeld: !buildLapDistancePath(broken).quality.usable,
    postFinishExcluded: buildLapDistancePath(extended).path.every(p => p.t <= a.lap.lap_duration),
    missingIsNull: interpolateField([{progress:0,speed:null},{progress:1,speed:10}],0.5,'progress','speed') === null,
    scenario: difference(assumptions),
    changedCommonCosts: difference({...assumptions,pitLoss:35,fuelGain:0.1,warmup:4}),
  };
})()`, context);
assert.ok(Math.abs(frozenResult.finish + 0.131) < 1e-9);
[-0.090, -0.038, -0.003].forEach((value, i) => assert.ok(Math.abs(frozenResult.sectorDeltas[i] - value) < 1e-9));
assert.equal(frozenResult.timestampsPreserved, true);
assert.ok(frozenResult.lastTime < frozenResult.duration);
assert.equal(frozenResult.badCoverageHeld, true);
assert.equal(frozenResult.postFinishExcluded, true);
assert.equal(frozenResult.missingIsNull, true);
assert.ok(Math.abs(frozenResult.scenario + 0.32) < 1e-9);
assert.ok(Math.abs(frozenResult.scenario - frozenResult.changedCommonCosts) < 1e-9);
const sparse = vm.runInContext(`(() => {
  const lap={quality:{usable:true,localGapLimit:0.72},path:[{progress:0,t:0},{progress:.2001,t:.1},{progress:.2021,t:1.3},{progress:1,t:1.4}]};
  const atGap=localDeltaAt(lap,lap,.201);
  // Both selected endpoints are supported, yet an unobserved interval lies
  // between them and can fall entirely between coarse export-grid points.
  return {atGap,range:localDeltaRangeSupported(lap,lap,.19,.21),endpoints:[localDeltaAt(lap,lap,.19),localDeltaAt(lap,lap,.21)]};
})()`, context);
assert.equal(sparse.atGap,null);
assert.equal(sparse.range,false);
assert.ok(sparse.endpoints.every(Number.isFinite));
console.log("analysis engine smoke test passed (synthetic invariants and real frozen data)");
