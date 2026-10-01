"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const E=require('../dist/race-engine.js'),{eligibility}=require('../tools/validate_predictions.cjs');
const report=require('../dist/data/prediction-validation.json'),follow=require('../dist/data/case-followup.json');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(require.resolve(file))).digest('hex');
assert.equal(report.engineHash,hash('../dist/race-engine.js'));
for(const [file,digest] of Object.entries(report.inputHashes))assert.equal(digest,hash('../dist/data/'+file));
const sum=o=>Object.values(o).reduce((s,n)=>s+n,0);
for(const s of report.sessions)for(const h of s.horizons){
 assert.equal(h.origins,sum(h.excluded)+h.eligible);
 assert.equal(h.eligible,sum(h.withheld)+h.n);
 assert.equal(h.n,h.scored);
 assert.equal(h.n===0,h.modelMAE===null);
}
for(const h of report.summary){assert.equal(h.n,report.sessions.reduce((s,r)=>s+r.horizons[h.h-1].n,0));assert.ok(h.modelMAE>h.baselineMAE);}
assert.equal(report.replacements.length,3);assert.ok(report.replacements.every(r=>!r.ageZeroSupported));
const ham=report.replacements.find(r=>r.driver===44);assert.deepEqual(ham.observed.map(r=>r.error),[.8405,.9272]);
// A much slower target is still scored if independent observed-condition rules pass.
const d=require('../dist/data/race-austin.json');
const lap=d.laps.find(l=>l.driver_number===44&&l.lap_number===51),controls=E.withRestartEstimates(d.raceControl,d.laps,Math.max(...d.laps.map(E.end).filter(Number.isFinite)));
assert.equal(eligibility(d,lap,controls),null);
const slow={...lap,lap_duration:lap.lap_duration+1};assert.equal(eligibility(d,slow,controls),null);
assert.equal(eligibility({...d,intervals:[]},lap,controls),'traffic_coverage_below_80pct');
const origin=d.laps.find(l=>l.driver_number===44&&l.lap_number===48),cut=E.end(origin);
const before=E.snapshot(d,cut,.035,5).rows.find(r=>r.driver===44);
const changed=structuredClone(d);changed.laps.filter(l=>E.time(l.date_start)>cut).forEach(l=>{l.lap_duration=1;});
const after=E.snapshot(changed,cut,.035,5).rows.find(r=>r.driver===44);
assert.deepEqual(after.pace,before.pace);
assert.equal(before.nextPace,E.paceAt(before.pace,before.age,49,.035));
assert.deepEqual(follow,JSON.parse(JSON.stringify(require('../tools/analyse_case_followup.cjs').analyse())));
assert.equal(follow.q3Pairs.length,1);assert.equal(follow.q2Pairs[0].lapA,13);
assert.deepEqual(follow.traces[0].drivers.map(r=>r.minimumSpeed),[94,93]);
for(const file of ['../dist/index.html','../dist/lab.js','../dist/app.js','../dist/validation.js'])assert.doesNotMatch(fs.readFileSync(require.resolve(file),'utf8'),/QSS|thermal model|열모델|physics_model_gate/);
console.log('Prediction report checks passed: hashes, coverage accounting, holds, target scoring, no future fit leakage and case matching.');
