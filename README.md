# F1 Performance Lab

[Open the site](https://minnnieeee.github.io/f1-performance-lab/) · [Source repository](https://github.com/Minnnieeee/f1-performance-lab)

By Min Annie Ji.

A public-telemetry analysis project: locate a lap-time difference, examine candidate mechanisms, and define the next engineering check. The interface opens with the same Silverstone NOR–PIA lap pair discussed in its featured case. No API token or OpenF1 request is needed to view that example.

## Problem

Where did Norris gain on Piastri in Silverstone 2023 Q3, lap 25, and which explanations do the available channels support?

Norris was 0.131s quicker overall, including 0.090s in S1. In the first detected speed zone, sampled minima were 98/93km/h. The first ≥95% throttle transition intervals overlap. The next check is deceleration and minimum-speed behaviour on laps with better-matched conditions; this does not establish a setup cause or assign the full S1 advantage to that zone.

## Data

- The bundled example is a frozen Formula 1 historical timing extract parsed with FastF1 3.8.3: two McLaren drivers, two Q3 telemetry/position laps each, and accompanying lap/stint/weather/control records. See `dist/data/demo.json` for provenance, source URLs and selection rules.
- NOR #4 / PIA #81, L25/L25, load automatically. L22 provides a contrasting pair, not a controlled validation: Norris is 0.658s slower and the tyre ages differ.
- REPLAY requests selected historical sessions from OpenF1. LIVE is optional and requires paid access; tokens are not persisted or exported. Loading the site itself still requires network access.
- Strategy uses separate frozen race examples or a selected completed Race/Sprint. Qualifying laps are not treated as a race tyre dataset.

## Assumptions

- Position defines approximate, dimensionless shared progress. It is not verified circuit distance in metres or a lateral racing-line measurement.
- Original lap-relative timestamps are preserved. Sector residuals are consistency checks, not error bounds or independent validation.
- Brake is binary, not pressure. Sampled minimum speed is not a geometric apex. Throttle transition positions are brackets between native samples.
- Fuel, setup and tow are not controlled. Pace-age slopes combine tyre, fuel and track effects; the explicit fuel correction does not identify them independently.
- Race comparisons are conditional on the evaluation horizon H, stop delay d and fuel assumption. Warm-up, pit loss, traffic cost and extrapolation allowance are editable assumptions. The forecast is not an optimal strategy or a physical race simulation.

## Method

1. Load the selected observations and retain provenance and missing values.
2. Clean obvious position outliers, construct A's reference path and project B onto that path within bounded progress neighbourhoods.
3. Compare telemetry at shared progress; withhold local time differences where boundary coverage or position sampling is inadequate.
4. Compare reported sector timing with position-derived timing, then inspect sampled speed minima and input transitions.
5. For race scenarios, reconstruct a cutoff-limited snapshot, fit eligible stint laps and compare stopping schedules over the same horizon. Share fitted-parameter uncertainty across the paired schedules.

The browser uses native JavaScript, SVG and DOM APIs. `app.js` handles data loading and core analysis; `lab.js` handles the example, context and exports; `workspace.js` handles linked inspection; `playback.js` synchronises traces, map and readouts. `race-engine.js` contains the historical race calculations, with `race-replay.js` as its UI adapter. See [race definitions](RACE_REPLAY.md) and the in-app Methodology for details.

## Validation

Implementation checks cover timestamp preservation, coverage masking, paired strategy cancellation, restart reconstruction, input handling and synchronised playback. Frozen-data checks reproduce the featured case's timing, minimum speeds and overlapping throttle brackets.

These checks are not evidence of real-world strategy accuracy. The 0.045s S1 boundary residual in the case is a consistency difference, not a validated precision limit. Authenticated LIVE has not been tested for this revision.

The current historical forecast check does not show an accuracy advantage for the regression over a recent-three-lap mean: MAE is 0.271/0.305/0.428s at +1/+2/+3 laps, versus 0.236/0.239/0.324s for the baseline. Scored coverage is 28/85, 23/79 and 17/76 eligible targets, mainly Austin. All three checked same-compound replacement events withhold age-zero pace. Two supported later HAM laps have +0.841/+0.927s error; that is not validation of a stop scenario. See [the full protocol, results and failure interpretation](dist/validation-report.md).

The Silverstone follow-up finds L22 minima of 94/93km/h at the same reference window, while Norris loses 0.086s in S1. Q3 has no second pair matching the defined conditions in the bundled subset. A matched-age Q2 L13 pair supplies timing-only context, not a mechanism replication. The claim remains specific to the observed laps.

See [numerical checks and known limits](VALIDATION.md) and [v8 corrections](dist/review-v8.md).

## Failure modes

- Sparse positions or missing boundaries can prevent a local time comparison even when speed samples remain available. The featured Zone 1 delta is withheld for this reason.
- Tyre age, traffic, start-time separation and changing conditions can reverse a comparison. The L22 result prevents a general claim of a repeatable Norris advantage from L25 alone.
- Sparse stint fits, unknown race-control state or unsupported extrapolation can withhold a scenario. Inputs are not relaxed merely to produce a result.
- Historical OpenF1 requests can fail or be restricted. REPLAY keeps its selected mode and displays the failure; the bundled example remains separately available.

## Session pace and full-catalog audit

Replay now loads pace context automatically, including practice. Timing analysis can continue when car/position traces are missing. In **Pace & tyres**, choose each driver's completed origin lap and an assumed pace offset. Three usable same-stint laps enable the recent-mean forecast; supported pace-age regression is shown alongside it. One/two-lap runs show measured references only. Fuel correction affects inferred age slope/support, not independent same-stint fuel-load prediction.

The 22 September 2026 audit checks all recorded drivers in 435 completed, non-cancelled 2023–2026 sessions (including testing). A three-lap estimate is available somewhere in 349 sessions; regression in 325. Existing default race strategies are available in 91/107 Race/Sprint sessions, at 3,201/5,494 inspected cutoffs for at least one driver pair. This is availability, not proof of useful accuracy or a winning strategy. Practice/qualifying errors remain large when the next lap changes run mode. The full methods, exclusions, paired errors and reproduction commands are in [the audit report](dist/session-audit.md).

## Reproduction

Serve `dist/` with a static server. With Python installed, run from this directory:

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:4173/`. The first graph loads NOR/PIA L25 automatically; playback covers the full lap. Select **Compare lap 25** to restore the pair and inspect the 13.6–27.2% case window. REPLAY opens other sessions; LIVE stays optional.

With Node.js installed, these checks need no additional packages:

```powershell
node tools/validate_predictions.cjs
node tools/analyse_case_followup.cjs
node tests/prediction_validation_checks.cjs
node tests/example_startup_checks.cjs
node tests/featured_case_checks.cjs
node tests/playback_checks.cjs
node tests/analysis_engine_smoke.js
node tests/review_regressions.cjs
node tests/race_engine_checks.cjs
node tests/v8_checks.cjs
```

The browser test scripts additionally require Playwright and an installed supported browser. Mocked network cases test software behaviour, not current API availability. The public source ZIP contains an explicit allowlist of this site, inputs, documentation and checks; it excludes the parent research repository and private TTC/team data. Regenerate it with `python tools/package_source.py`.

## Project contribution and external components

| Project-specific implementation | External source or component |
|---|---|
| The engineering question, case interpretation and choice of follow-up checks | Formula 1 timing and telemetry observations |
| Approximate shared-progress alignment, coverage gates and sector consistency checks | FastF1 parses the historical archive; it is not the dashboard's alignment engine |
| Linked plots, position/RPM playback and selected-window inspection | Browser JavaScript/SVG/DOM APIs; no third-party charting runtime |
| Historical cutoff reconstruction, stint fits, paired stop schedules and assumption handling | OpenF1 supplies replay/live observations; it does not supply this project's forecasts |
| Regression checks, provenance exports and source packaging | Node.js and Python provide execution and packaging tools |

Formula 1, FastF1 and OpenF1 data/source rights remain with their respective owners. This project is unofficial and does not claim a blanket licence over their data.

## Hosting

GitHub Pages publishes `dist/` when changes are pushed to `main`. The workflow runs the bundled startup and featured-case checks before deployment. The site uses browser JavaScript and requires no application server.
