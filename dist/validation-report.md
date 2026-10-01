# Historical prediction checks — 22 September 2026

This initial four-race check is retained for its traffic-filtered scoring and replacement diagnostic. See [the all-session audit](./session-audit.md) for the 2023–2026 catalog-wide results.

## Question and fixed scope

Does the dashboard's current pace-age regression improve next-lap estimates over a recent-lap average, and does a pre-stop same-compound fit transfer to replacement tyres?

Implementation tests establish calculation consistency, not predictive usefulness. Errors of a few tenths of a second could change whether small pace advantages deserve further investigation. This check therefore measures error in seconds and forecast availability; it adds no alternative statistical model, parameter search, bootstrap or significance claim.

Use the four already-bundled race datasets and their designated driver pairs: Austin 9213 (1/44), Las Vegas 9189 (1/16), Monza 9157 (1/11), Marina Bay 9165 (55/4). Only these drivers have full interval histories in the fixtures. These datasets have already been used during development: this is a retrospective future-lap check, not an untouched external benchmark or a live trial.

The forecast implementation and input hashes are recorded in `data/prediction-validation.json`. No forecast coefficients, support gates or score filters were tuned after seeing these results. Forecast equations and support gates remain unchanged; repeated control and interval lookups were later indexed for the full-grid audit.

## Same-stint protocol

At each completed driver lap, construct the existing engine snapshot using only records at or before that lap's end. Fix fuel gain at 0.035s/lap and age extrapolation allowance at 5 laps, the site's defaults. Predict the numbered laps +1, +2 and +3 in the same stint with the existing age-support and negative-trend gates. Excluded laps still count towards age and forecast horizon.

The comparison baseline is the mean of the last three raw lap times among the model's fit-eligible pre-cutoff laps. Both methods are scored on identical supported targets. A target must have a valid duration, remain in the same recorded stint, avoid recorded pit/in/out laps, have only green or inferred-green status during that target lap, have at least 80% known front-interval coverage and at most 20% close-traffic exposure. These are recorded-condition filters, not proof of clean air. They apply to the target lap; the +2/+3 protocol does not require every intervening lap to pass those filters. There is no future best-lap threshold that removes unexpectedly slow targets.

Future records classify outcomes only; they never supply fit points or forecast conditions. The source is archived event-time data, which may include retrospective corrections. Overlapping forecast origins are not independent experiments.

## Results

Error = predicted minus actual lap time; positive means a slower predicted lap. MAE is mean absolute error, not a confidence interval.

| Target | Eligible targets | Forecasts scored | Regression MAE | Recent-3 mean MAE | Regression bias |
|---|---:|---:|---:|---:|---:|
| +1 lap | 85 | 28 | 0.271s | 0.236s | 0.000s |
| +2 laps | 79 | 23 | 0.305s | 0.239s | +0.039s |
| +3 laps | 76 | 17 | 0.428s | 0.324s | +0.065s |

The regression's absolute error exceeds the baseline by about 0.035s, 0.067s and 0.104s. It has not demonstrated an accuracy advantage in this check. Do not extrapolate these figures to all circuits or use them as uncertainty bounds for differences between pit strategies.

| Race | +1 scored / eligible | +2 | +3 |
|---|---:|---:|---:|
| Austin | 23 / 49 | 19 / 46 | 15 / 43 |
| Las Vegas | 0 / 12 | 0 / 10 | 0 / 10 |
| Monza | 5 / 14 | 4 / 13 | 2 / 13 |
| Marina Bay | 0 / 10 | 0 / 10 | 0 / 10 |

Most scored predictions come from Austin. Eligible-but-withheld targets lack a pre-cutoff fit, need negative-trend extrapolation or exceed age support. Missing traffic coverage and affected targets are separately excluded before assessing model availability. Complete counts, including all attempted origins, are in the JSON. No-result races are not successful validation cases.

## What fails, and what that means for use

At Austin, HAM L48→L51 is predicted 0.980s slower than the actual lap; the recent-three mean is 0.510s slower. The historical trend does not follow the later improvement in pace. At Monza, PER L46→L47 is predicted 0.955s faster than observed; the baseline also misses the slowdown by 0.851s. These observations show changing pace that neither summary fully captures. They do not identify fuel, tyre condition, driver management or residual traffic as the unique cause.

The engineering implication is to keep the regression as a conditional trend/scenario tool, not claim that its extra complexity produces more accurate short-term pace forecasts. A race decision separated by a small predicted advantage needs additional evidence; these lap errors cannot simply be added to or substituted for the paired parameter-only interval.

## Tyre replacement transfer

Select every observed replacement stint among the same designated drivers whose compound has already appeared earlier in that driver's race. Freeze the latest same-compound fit at the last completed non-pit lap before the actual stop. Inspect only the first five numbered laps of the new stint; do not search farther for convenient outcomes. Apply the same target-quality rules and recorded starting set age.

| Event | Frozen fit | Fresh age-zero forecast | Result |
|---|---|---|---|
| Austin VER, medium → medium | Before L16 stop, cutoff L15; source stint 1 | Withheld | Negative fitted trend requires low-age extrapolation; L18–21 observed but predicted pace withheld |
| Austin HAM, return to medium | Cutoff L37; source stint 1 | Withheld | Age zero exceeds lower-age support. Ages 1–2 are supported: L40/L41 predictions are 0.841s / 0.927s slower than observations |
| Las Vegas VER, hard → hard | Cutoff L25 | Withheld | No eligible earlier hard fit; first five replacement laps contain pit/neutralisation/traffic exclusions |

All three age-zero estimates are withheld. The two supported HAM later-lap estimates are a limited transfer diagnostic, not successful validation of a complete stop scenario. Recorded new-set ages are zero in these events, but that source convention is not a measured tyre state. The observed change combines stint, fuel, track, traffic and driver effects.

Outlaps remain excluded: their duration cannot isolate a warm-up penalty from pit-lane traversal and acceleration. Net pit loss and counterfactual alternative stop schedules are not validated here. Pit-lane duration is not substituted for net race-time loss. The engine's support gates have not been relaxed.

## Silverstone case follow-up

The available subset contains 20 timing laps and four native telemetry extracts. Search Q3 pairs using the same phase, compound, source-reported start age and fresh-set flag, green status, starts within 60s and each lap within 8% of its driver's bundled phase best. This selects only the original L25 pair. There is no second matched Q3 replication in this subset.

As a separate context check, the same rules in Q2 select NOR/PIA L13, ages 1/1, starts 41.906s apart. NOR−PIA sector differences are −0.097 / +0.228 / −0.270s; overall −0.139s. S1 again favours Norris, but S3 is the largest difference. Native telemetry is not included for this pair, so it cannot verify the minimum-speed or throttle mechanism. Track evolution and tow remain uncontrolled.

To inspect the L22 counterexample consistently, project both L22 traces onto the NOR L25 reference and inspect the same 13.6–27.2% interval. Sampled minima are 94/93km/h, compared with 98/93km/h on L25. Both pairs have overlapping ≥95% throttle-recovery brackets. Despite the 1km/h minimum-speed advantage, Norris is 0.086s slower in S1 on L22. Tyre ages differ (5/4), so this is not a controlled test of driver behaviour.

Retain the L25 observation and the deceleration/minimum-speed investigation priority. Minimum speed alone does not explain a whole sector's time difference, and these data do not support a repeatable trait, an exact local gain or a setup recommendation. The follow-up has narrowed the claim rather than confirmed the proposed mechanism.

## Reproduction

From the downloaded source root, with Node.js installed and no extra packages:

```text
node tools/validate_predictions.cjs
node tools/analyse_case_followup.cjs
node tests/prediction_validation_checks.cjs
```

The scripts use only frozen files; no credentials, private datasets or live requests. They save final summary JSON and essential replacement/worst-error diagnostics, not intermediate iterations or every forecast row. The UI reads those same published results. Engine and data hashes prevent a changed model from silently inheriting an old report.
