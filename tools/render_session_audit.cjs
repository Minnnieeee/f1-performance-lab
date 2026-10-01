"use strict";
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),p=require('../dist/data/session-audit.json'),r=require('../dist/data/race-availability.json');
const good=p.sessions.filter(s=>!s.error),rows=r.sessions.filter(s=>!s.error),n=a=>a.toLocaleString('en-US');
function pooled(type,h,key){const a=p.groups.filter(g=>g.type===type).map(g=>g.horizons[h-1][key]),count=a.reduce((s,v)=>s+v.n,0);return {n:count,mae:count?a.reduce((s,v)=>s+v.n*(v.mae||0),0)/count:null};}
const fmt=v=>v==null?'—':v.toFixed(3)+'s';
const text=`# All-session pace and race-strategy availability — 22 September 2026

## What was checked

All completed, non-cancelled entries returned by OpenF1 for 2023–2026 at retrieval: **${good.length} sessions**, every recorded driver. The catalog also lists ${p.cancelled.length} cancelled entries; these are not counted as prediction failures. The scope includes practice and preseason testing, qualifying and sprint qualifying, races and sprints. Download failures: ${p.sessions.filter(s=>s.error).length} for timing inputs, ${r.sessions.filter(s=>s.error).length} for race inputs. An empty API response remains an empty-data result, not a successful calculation.

Three different questions are kept separate: can the program calculate an estimate, how closely does that estimate match a later observed lap, and does a complete pit scenario have sufficient data? None implies the others. These seasons were not pooled to train a new model; each forecast uses only the selected driver's earlier laps in that session.

## Availability

**${good.filter(s=>s.available>0).length}/${good.length} sessions** have at least one three-lap pace estimate. **${good.filter(s=>s.trendAvailable>0).length}/${good.length}** also have a supported pace-age regression estimate. **${good.filter(s=>s.referenceAvailable>0).length}/${good.length}** provide at least an observed reference; one/two-lap references are not published as next-lap predictions. These counts mean at least one usable driver/cutoff, not every selection in a session.

| Year | Session type | Sessions | Recent-3 estimate available | Regression available |
|---|---|---:|---:|---:|
${p.groups.map(g=>`| ${g.year} | ${g.type==='Race'?'Race / Sprint':g.type==='Qualifying'?'Qualifying / Sprint qualifying':'Practice / testing'} | ${g.sessions} | ${g.withForecast} | ${g.withTrend} |`).join('\n')}

The five sessions with no usable reference are ${good.filter(s=>!s.referenceAvailable).map(s=>`${s.year} ${s.location} ${s.name} (${s.sessionKey})`).join('; ')}. They contain no supplied laps, no usable non-pit/green laps, or missing session-opening control records. The JSON gives every session's counts and exclusion reasons.

### Existing race-strategy calculation

**${rows.filter(s=>s.available>0).length}/${rows.length} Race/Sprint sessions** have at least one supported default stop scenario. **${n(rows.reduce((s,v)=>s+v.available,0))}/${n(rows.reduce((s,v)=>s+v.cutoffs,0))} inspected cutoffs** have a qualifying pair. This uses the existing strategy engine, H=12, d=3, fuel gain=0.035s/lap, age allowance=5, each car's current compound and recorded track status. At the earliest recorded completion of each lap number, inspect all distinct driver pairs until one supports stop offsets 0:3, 3:0 or 0:0. Actual position/interval histories are loaded for the whole grid. The three-case +/- assumption variants do not change age support; this scan uses the base case. It does not test every driver-lap timestamp, every input setting, or validate which strategy would win.

## Forecast errors

Freeze each completed driver lap, then score numbered laps +1/+2/+3 only when the target remains in the same recorded stint and has usable timing/control. Do not discard a future target just because it is slow. All-driver forecasts here are **traffic-unfiltered observed pace**: public intervals are unavailable in non-race sessions, and this error comparison does not select clean-air race laps either. It is a different scoring population from the initial four-race traffic-filtered check. Forecast windows overlap and are not independent experiments.

| Type | Horizon | Recent-3 scored | Recent-3 MAE, all its targets | Paired targets | Recent-3 MAE, paired | Regression MAE, paired |
|---|---:|---:|---:|---:|---:|---:|
${['Practice','Qualifying','Race'].flatMap(type=>[1,2,3].map(h=>{const all=pooled(type,h,'recent'),paired=pooled(type,h,'pairedRecent'),trend=pooled(type,h,'trend');return `| ${type==='Race'?'Race / Sprint':type} | +${h} | ${n(all.n)} | ${fmt(all.mae)} | ${n(trend.n)} | ${fmt(paired.mae)} | ${fmt(trend.mae)} |`;})).join('\n')}

Practice and qualifying errors are larger than race errors. Preparation, cooldown and push laps can alternate within a stint; the next numbered lap need not continue the previous pace. Timing alone cannot identify the driver's intended programme, fuel load or traffic as a unique cause. Short qualifying runs rarely contain three comparable earlier laps, so the UI retains their measured reference instead of pretending a regression exists. The trend model has no general demonstrated accuracy advantage here. A calculated value is not evidence of useful accuracy for every session type.

## Corrections made while auditing

- Timing analysis now survives missing car/position traces; graph availability no longer gates pace analysis. Session context loads automatically after Replay selection. Cancelled sessions are omitted from Replay.
- Pace estimation is independent of race gaps and pit-strategy eligibility. Three usable same-stint laps enable a recent-mean estimate even when a negative trend or missing tyre age prevents regression. One/two usable laps remain references only.
- Some non-race pit records identify the outlap itself. If that lap is explicitly marked pit-out, the following flying lap is retained; a race pit-entry record still excludes its following outlap. Recorded pit segments (2064) are excluded independently.
- When sector fields are supplied, all three must be present and positive, and their sum must agree with lap duration within 0.1s. This rejects incomplete/contradictory timing, including records spanning garage stays, without an error-based or future-speed cutoff. These corrections followed direct inspection of bad records, not an optimisation of reported accuracy.
- A lap already underway may finish after the chequered flag, but no continuation is forecast after that phase finishes. A non-race pit-exit green-light message lacking a flag is explicitly inferred as session opening; the same inference is never applied to a race start. Unknown/red/yellow states remain excluded.
- Repeated strategy snapshots use indexed interval windows and compiled control transitions. Snapshot parity checks preserve the existing predictions and support gates; no strategy rule was relaxed to increase coverage.

## Inputs and use

Pace uses the last three prior usable laps in the same recorded stint, with a past-only 8% preparation-lap filter and a last-usable-lap age limit of three lap numbers. Regression uses at least three known-age points and the existing extrapolation limits. No different stint or compound is silently substituted.

The pace-change input adds an explicit assumed time difference to each future lap; it does not infer a physical setup effect. Fuel correction changes the inferred pace-age slope and support gate. In a continuing stint, its linear contribution cancels again when converting the fit back to raw lap time, so it is not an independent fuel-load experiment. Strategy still exposes H, d, fuel, tyre replacement and pit-loss assumptions separately.

The all-session audit is retrospective and includes data-quality corrections developed during this audit. It is not an untouched external benchmark, a live test, a calibrated forecast interval, or validation of tyre thermal state or actual counterfactual race outcomes.

## Reproduction

Use Node.js, no additional packages. From the source root:

\`\`\`text
node tools/collect_sessions.cjs
node tools/collect_race_gaps.cjs
node tools/audit_all_sessions.cjs
node tools/audit_race_availability.cjs
node tools/render_session_audit.cjs
node tests/session_pace_checks.cjs
node tests/timing_only_checks.cjs
node tests/full_audit_checks.cjs
\`\`\`

Collectors serialise requests, back off on rate limits and preserve raw responses in the ignored .sites-runtime/openf1-full directory. Only final aggregate reports and essential failure examples are published. The source archive contains the retrieval and analysis code; the complete raw cache is not republished. Original source files and engine hashes are in the JSON. Later API corrections may produce different hashes/results; do not describe a changed retrieval as the same frozen dataset.

[Session-level results](./data/session-audit.json) · [Race decision availability](./data/race-availability.json) · [OpenF1 endpoint definitions](https://openf1.org/docs/)
`;
fs.writeFileSync(path.join(root,'dist/session-audit.md'),text);
console.log('Full-session report rendered from published results.');
