# Historical race strategy — implementation and limits

**Superseded implementation record:** the following describes the earlier revision and its historical checks. Current equations, guards, control-state handling and final results are documented in [v8 review response](dist/review-v8.md). In particular, the old 1.4/1.2 neutralised lap pace, shared warm-up input and UNKNOWN/SC_ENDING behaviour are no longer current.

2026-09-13. The user explicitly excluded LIVE. This revision adds historical decision-point analysis, not authenticated live strategy or a calibrated race simulator. The version-8 distance/telemetry implementation and frozen qualifying data are preserved.

## Use

1. REPLAY → a completed Race or Sprint → select two drivers.
2. STRATEGY → choose the end of A's lap → LOAD RACE SNAPSHOT.
3. Inspect the field, fitted lap/age coverage and recorded control status. UNKNOWN/RED holds strategy; choosing GREEN/SC/VSC explicitly creates an **assumed counterfactual**, not a relabelled observation.
4. Select replacement compounds that have pre-cutoff evidence; adjust horizon, rival stop delay, pit loss, fuel, warm-up and traffic assumptions. No network calls are needed for input changes.
5. Compare both-stop and horizon gaps; export the exact scenario JSON. The separate full-session benchmark intentionally remains labelled as using the full session.

## Definitions

The cutoff is A's reported lap start plus lap duration. Only completed laps with end ≤ cutoff enter the model. Fit cleaning, stint selection, traffic samples, pit records, weather and race-control states are restricted to this time. Metadata are archived/final-source data, not an original packet-arrival replay.

For each earlier observed stint, fit **corrected time = intercept + slope × tyre age**, with the same OLS line for R² and prediction. Race fuel correction is an input in seconds per race lap. Exclude observed pit/in/out, lap 1, laps more than 8% slower than the available stint best, observed close traffic, and recognised SC/VSC/red-affected laps. Unknown traffic/control coverage is counted and displayed, not called clean air. Three samples are a minimum implementation gate, not model validation. Excluded laps still increment tyre age. The current age is after the last completed lap; an in-progress lap's fraction is not estimated.

Fresh pace uses that compound's earlier fit at age zero. This can be a substantial extrapolation. No measured temperature, wear, load, grip or tyre inventory is available to this model. A negative fitted slope remains negative and must not be interpreted as negative physical tyre wear.

Let **g = gapA − gapB**, in seconds; g<0 means A ahead. For each common scenario step:

`g_next = g + paceA − paceB + netPitLossA − netPitLossB + warmupA − warmupB + trafficA − trafficB`.

One same- or separately fitted-compound change per car. A first/B delayed, A delayed/B first, and both now are compared after **both** stops and at a common horizon. 'Now' means the next modelled pit opportunity, not a known instantaneous pit-entry location. This is a coarse lap-step forecast from an approximate event-time snapshot, not exact wall-clock race propagation. Signed gap crossing is not a demonstrated overtake. The stop scan varies A's offset with B's chosen response fixed; it does not claim a global optimum.

The displayed assumption range evaluates three explicit favourable/base/unfavourable combinations: relative pace ±input per green lap, relative pit loss ±input per pair. It is not a confidence interval, exhaustive bound or probability. Warm-up and traffic assumptions are not part of those automatic three-way variations; users can change them explicitly.

Rejoin adds A's net pit loss to its current leader gap and retains other eligible cars' gaps, with no other stops or field pace evolution. It is a **frozen-field time-loss estimate**, not a pit-exit geometry prediction. Only numeric same-lap gaps no older than 15 s, within 5 s of A and with a recent completed lap are eligible. A partial field is labelled as such. Pit-lane duration is not substituted for net pit loss. The <1.5 s exposure flag suggests a traffic investigation; the optional traffic cost is not inferred from that flag.

SC/VSC reduce assumed pit loss by the selected factor. For the assumed neutralised steps the pair simulation uses a common neutralised lap pace (1.4× the larger green pace for SC, 1.2× for VSC); this artificial common term cancels from the gap. No SC bunching, pickup, restart or incident-position model is present. Rejoin rank and success claims are therefore withheld during SC/VSC scenarios. Future duration is an assumption, never read from later messages. Unknown global control is not silently GREEN. Ending/in-this-lap messages remain neutralised until a recognised global restart. Local sector and pit-exit GREEN messages cannot clear the state.

Endpoint definitions: [OpenF1 documentation](https://openf1.org/docs/), especially laps, stints, position, intervals and race control. The source describes lap starts as approximate; lap-down gaps may be strings, not convertible seconds. The API does not promise a complete global control-state transition vocabulary; unrecognised history remains unknown.

## Checks

`tests/race_engine_checks.cjs` uses the clearly synthetic `tests/race_fixtures.cjs`, which is never displayed as a real race. Checks cover:

- Future laps, stint endpoints/compounds, positions and SC events cannot alter an earlier snapshot.
- Excluded laps still age tyres; unknown age does not become zero.
- Stale/missing/lap-down gaps withhold strategy; a 1 s timestamp difference is accepted and 6 s rejected (milliseconds are converted correctly).
- Genuine pit loss appears after one stop and cancels after both stops for identical models.
- SC/VSC ending holds, sector/pit GREEN rejection, explicit global restart and SC rejoin suppression.
- Unobserved compounds withhold a result; displayed scenario ranges contain the base case.

`tests/race_browser_checks.cjs` checks the actual controls, bounded date queries, cache reuse, cursor invalidation, JSON/query equivalence, English/Korean and mobile layout with mocked API data. Existing engine, workspace, browser and export regression scripts also pass; their meaning remains implementation verification, not race-prediction accuracy.

The optional `tests/race_real_smoke.cjs` performs real requests only when explicitly enabled with `LAB_REAL_HISTORY=1`. It requests **2023 British Grand Prix Race, OpenF1 session 9126**, not LIVE. No token was used. It checks A=Norris #4, B=Piastri #81, A L25 ending at **2023-07-09T14:41:58.003Z**:

| Observed / derived item | Result |
|---|---|
| Driver field / completed driver-laps before cutoff | 20 / 467 |
| Reported position A / B | P2 / P3 |
| Reported leader gap A / B | 6.582 / 8.816 s |
| Gap sample age A / B | 0.166 / 0.853 s |
| Tyre age after last completed lap A / B | 25 / 24 |
| Usable current-stint fit laps A / B | 14 / 12 |
| Pace-age slope with fuel assumption 0.035 s/lap | −0.011163 / −0.034444 s/lap |
| Linear next-lap pace estimates | 92.540 / 92.469 s |
| Recognised recorded global control at this cutoff | UNKNOWN; no silent GREEN fallback |

With **explicit user-scenario GREEN**, default 12-step horizon, 3-step delay, 22 s pit loss, 0.6 s warm-up, zero traffic costs, same MEDIUM replacement and relative ranges ±0.3 s/lap / ±2 s:

| Scenario | A−B after both stops | Three-assumption range |
|---|---|---|
| A first, B after 3 steps | −1.623 s | −4.823 … +1.577 s |
| B first, A after 3 steps | −4.804 s | −8.004 … −1.604 s |
| Both at next opportunity | −2.710 s | −5.010 … −0.410 s |

These numbers are **not historical outcomes or verified optimal decisions**. At this point A was already ahead, negative pace-age trends were present and fresh-tyre predictions extrapolate far outside the fitted ages. The undercut range crosses zero, so even these selected assumptions do not give a stable A-ahead conclusion. This is an engineering scenario to interrogate, not a recommendation to pit.

The snapshot rejoin calculation found 18 eligible cars out of 20 and an ahead-car gap of 1.312 s under the fixed-field/22 s loss assumption; it is not a full-field predicted P8. Missing/lapped/stale observations are excluded, not fabricated. The complete exported scenario states eligibility and assumptions.

The same real-session check then moved to A L35, cutoff **2023-07-09T15:00:03.017Z**. The earlier **SAFETY CAR DEPLOYED** record at **14:54:18Z** was recognised as SC. Rejoin rank remained withheld; the pair forecast was additionally held because a current-stint pace fit lacked sufficient usable laps. The screen did not substitute later green laps to fill the missing fit. SC/VSC pit-loss counterfactuals remain available separately.

No paid LIVE testing, calibrated passing probability or full race optimisation was performed. Existing S1 local-Δ residual remains approximately +0.045 s and is unrelated to the new strategy model.
