"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const p=require('../dist/data/session-audit.json'),r=require('../dist/data/race-availability.json');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex');
assert.equal(p.engineHash,hash('dist/pace-engine.js'));assert.equal(r.engineHash,hash('dist/race-engine.js'));
assert.equal(new Set(p.sessions.map(s=>s.sessionKey)).size,p.sessions.length);
assert.equal(p.sessions.length,435);assert.equal(p.cancelled.length,15);assert.equal(r.sessions.length,107);
assert.ok(p.sessions.every(s=>!s.error));assert.ok(r.sessions.every(s=>!s.error));
const sum=o=>Object.values(o).reduce((s,n)=>s+n,0);
for(const s of p.sessions){
 assert.equal(s.origins,s.available+sum(s.withheld));
 assert.ok(s.trendAvailable<=s.available);assert.ok(s.available<=(s.referenceAvailable||0));
 for(const h of s.horizons){assert.equal(s.origins,h.eligible+sum(h.excluded));assert.ok(h.recent.n<=h.eligible);assert.equal(h.trend.n,h.pairedRecent.n);assert.ok(h.trend.n<=h.recent.n);assert.equal(h.threeLapRecent.n,h.recent.n);}
}
for(const s of r.sessions)assert.equal(s.cutoffs,s.available+sum(s.withheld));
assert.equal(p.sessions.filter(s=>s.available>0).length,349);
assert.equal(p.sessions.filter(s=>s.trendAvailable>0).length,325);
assert.equal(r.sessions.filter(s=>s.available>0).length,91);
// Check preserved raw-input hashes when the downloaded cache is available.
for(const report of [p,r])for(const [name,digest] of Object.entries(report.inputHashes)){
 const file=path.join(__dirname,'../.sites-runtime/openf1-full',name);if(fs.existsSync(file))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),digest,name);
}
console.log('All-session audit checks passed: complete catalog, engine/input provenance, coverage denominators and paired comparisons.');
