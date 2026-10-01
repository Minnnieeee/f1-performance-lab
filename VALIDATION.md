# Bounded correction record — 2026-09-12

Scope: the five issues reported against published version 7. No new analytical features, extra statistical models or physical-accuracy claims. The bundled observations in `dist/data/demo.json` are unchanged. The baseline source is commit `21127de7edfa783bd45988802c93db9c9023ef87`.

## 1. Position-derived Δt boundaries

**Cause.** The five-point coordinate median used truncated three/four-point windows at each end. Those windows moved a coordinate away from its recorded time. Separately, projection could clamp a B observation outside A's measured path onto the endpoint. Either operation can manufacture a boundary time difference for identical motion sampled at different times.

**Correction.** Preserve the first/last two coordinates at their native timestamps; apply the existing median only in the interior. Do not assign an out-of-reference B observation to a reference endpoint. Compare only common observed support, including the existing gap/plateau guards. Do not stretch time, fit sector boundaries or smooth the Δ curve.

**Reproduction.** A 90 s straight trajectory has x=40t, y=0, with 0.24 s sampling. A/B sample phases differ by 0.15 s. Test both explicit common endpoints (phases 0.05/0.20 s) and no common endpoints (0.01/0.16 s). The former implementation reproduced a maximum 0.15 s artifact.

| Check | Corrected result |
|---|---|
| Identical straight motion, common endpoints | Maximum absolute Δ ≈1.42×10⁻¹⁴ s; endpoints zero |
| Identical straight motion, non-common endpoints | Same numerical-zero interior; unsupported endpoints null |
| Genuine B time offset +0.7 s | A−B=−0.7 s retained; maximum error ≈1.71×10⁻¹⁴ s |
| Same-time ellipse, x=1000 cos(2πt/90), y=700 sin(2πt/90) | Maximum phase artifact ≈0.000172 s, not exactly zero |

The ellipse result reflects polygon/interpolation geometry in this fixture. It is not a validation bound for recorded F1 coordinates. Native timestamps remain unchanged.

## 2. Missing values and empty inputs

Shared conversion now preserves null/undefined/empty/whitespace numeric values as null. Boolean brake false and numeric zero remain valid zero values. Missing speed does not draw a zero-speed segment; missing brake does not create an ON/OFF transition. All-missing summary inputs return null. The mixed known/missing fixture retains minimum speed 0, full-throttle fraction 50% of known throttle samples, and one observed brake transition.

Unknown tyre age remains unknown. A stint without usable ages has zero fitted laps and null baseline/current age; it cannot feed a strategy result. Two fitted laps still show limited interpretation, with R² suppressed. The blank fuel-gain control applies the existing default 0.035 s/lap; explicit 0 applies 0. Controls show defaults on completion of editing.

## 3. One set of applied conditions

**Reproduction.** Set horizon=3 laps and delay=29 laps. The previous calculation used delay=2 but retained the raw 29 in exported assumptions.

**Correction/result.** A shared input resolver constrains delay to horizon−1. The control, displayed result, actual downloaded JSON and registered analysis query all return **2**. The same shared resolver supplies fuel correction and all other scenario inputs.

For progress view, set the selected window to 30–50%, progress cursor to 40%, and the independent replay time to 10 s. The current-screen query and JSON display snapshot now match the aligned speed and driver-specific time displayed at 40%, not the replay clock. Time view uses the same latest-sample rule as its readouts. Missing telemetry remains null in queries/exports and an em dash on screen. JSON schema version 2 explicitly includes cursor axis, value and window.

## 4. One regression line and paired trend centering

### Stint pace baseline

Fixture: tyre ages 0, 1, 2; corrected lap times 90.0, 90.0, 90.3 s; fuel gain=0. Ordinary least squares gives slope 0.15 s/lap and intercept 89.95 s. Previously the displayed R²=0.75 came from this line, while the predicted baseline used a median-residual intercept of 90.0 s; that different line has R²=0.625 for the fixture.

The baseline now uses the existing regression's own intercept. Displayed R² and the line used for prediction both reproduce **0.75**, with baseline **89.95 s** and slope **0.15 s/lap**. Raw/corrected medians remain descriptive summaries, not alternate model intercepts. This fixes internal consistency; it does not establish predictive validity or identify pure tyre degradation.

### Non-race session trend

Fixture with a known −4 s/hour trend:

| Driver | Session elapsed time (h) | Lap time (s) |
|---|---|---|
| A | 0, 0.25 | 90, 89 |
| B | 0.50, 0.75 | 91, 90 |

Centering only lap time within driver, then fitting against pooled time, previously returned **−0.8 s/hour**. Centering both time and lap time within each driver's same paired observations returns **−4 s/hour** with the existing linear fit. This removes the between-driver schedule spread from the slope denominator. The race and frozen-subset exclusions remain. Real tyre age, fuel, traffic, driver programme and weather can still confound this proxy; the fixture is an implementation check, not identification of physical track evolution.

## 5. Single Δ view and preserved existing results

The duplicate lower Δ SVG and its handlers/styles were removed. The four linked traces remain. The former distance tab is now **ALIGNMENT CHECK / 정렬 점검**, retaining quality/coverage metrics and sector residuals with navigation to the linked traces.

Unchanged frozen NOR L25 / PIA L25 results:

- Reported finish A−B: **−0.131 s**.
- Reported sectors: **−0.090 / −0.038 / −0.003 s**.
- S1 position-derived cumulative Δ: **−0.045280741 s**; residual versus reported cumulative timing: **+0.044719259 s**.
- S2 residual: **−0.011959619 s**. S3 position residual remains unavailable.
- Existing native-statistic, derived-acceleration, regression-slope and pit/fuel/warm-up cancellation assertions pass.

**Important coordinate change:** restoring endpoints changes A's normalized reference length and origin. A numeric percentage is therefore not the same physical position as before. Version 7's 30–50% window corresponds to A times **26.946459986–45.708261072 s**, which now map to approximately **30.222170529–50.130072507%**. At these same physical endpoints the interval Δ remains **−0.084671406 s** (difference ≈7.1×10⁻¹⁵ s). The new literal 30–50% window has Δ **−0.106889628 s**, equal to its direct A-minus-B elapsed-duration calculation; it is a different interval, not a changed answer for the same positions.

The S1 residual was not forced to zero. Local small-interval differences still need sampling/alignment caveats; sector residuals are not a universal ±error bound. The useful engineering outcome is a more reliable inspection tool for braking/throttle/speed comparisons, not evidence that a 0.01 s local advantage can be resolved or attributed to setup or driver technique.

## Executed checks

Run numerical tests from the project root with Node.js:

```powershell
node tests/analysis_engine_smoke.js
node tests/review_regressions.cjs
```

Serve `dist/` at `http://127.0.0.1:4173/`, then run the browser checks with Playwright and Chrome installed (or `LAB_BROWSER=msedge`):

```powershell
node tests/browser_smoke.cjs
node tests/workspace_smoke.cjs
node tests/review_browser_smoke.cjs
```

All five scripts passed. Browser checks include the registered read-only query functions, a real local JSON download, applied-input synchronization, linked cursor, single Δ chart, English/Korean, existing replay failure/retry fixtures and mobile layout. Remote API responses are mocked in those scenarios. Authenticated LIVE and current OpenF1 service availability were not tested. No subscription, domain or data access policy changed.

The public source ZIP includes this record and the exact tests through an explicit allowlist. No parent-repository, private TTC, team or credential files are included.
