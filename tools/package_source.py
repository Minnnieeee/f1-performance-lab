"""Public source download: an explicit, non-sensitive allowlist."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
files = [
    ".github/workflows/pages.yml", "dist/.nojekyll",
    "dist/pace-engine.js", "dist/session-pace.js", "dist/session-audit.md", "dist/data/session-audit.json", "dist/data/race-availability.json",
    "tools/collect_sessions.cjs", "tools/collect_race_gaps.cjs", "tools/audit_all_sessions.cjs", "tools/audit_race_availability.cjs", "tools/render_session_audit.cjs",
    "tests/session_pace_checks.cjs", "tests/timing_only_checks.cjs", "tests/full_audit_checks.cjs",
    "dist/validation.js", "dist/validation-report.md", "dist/data/prediction-validation.json", "dist/data/case-followup.json",
    "tools/validate_predictions.cjs", "tools/analyse_case_followup.cjs", "tests/prediction_validation_checks.cjs",
    "README.md", "VALIDATION.md", "RACE_REPLAY.md", "dist/index.html", "dist/styles.css", "dist/app.js",
    "dist/lab.js", "dist/workspace.js", "dist/playback.js", "dist/favicon.svg", "dist/data/demo.json",
    "tests/analysis_engine_smoke.js", "tests/browser_smoke.cjs", "tests/workspace_smoke.cjs",
    "tests/review_regressions.cjs", "tests/review_browser_smoke.cjs",
    "dist/race-engine.js", "dist/race-replay.js", "tests/race_fixtures.cjs",
    "tests/race_engine_checks.cjs", "tests/race_browser_checks.cjs", "tests/race_real_smoke.cjs",
    "tools/package_source.py", "tools/freeze_race.cjs", "tests/v5_checks.cjs",
    "dist/review-v8.md", "tests/v8_checks.cjs", "tests/data/miami-control.json",
    "dist/review-v6.md", "tests/v6_checks.cjs", "tests/data/melbourne-control.json",
    "dist/review-v5.md", "dist/data/race-demo.json", "dist/data/race-austin.json",
    "dist/data/race-monza.json", "dist/data/race-singapore.json", "tests/selection_checks.cjs",
    "tests/strategy_layout_checks.cjs", "tests/playback_checks.cjs", "tests/featured_case_checks.cjs", "tests/example_startup_checks.cjs",
]
with zipfile.ZipFile(root / "dist/source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        info = zipfile.ZipInfo(name, date_time=(2026, 10, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, (root / name).read_bytes())
with zipfile.ZipFile(root / "dist/source.zip") as archive:
    assert sorted(archive.namelist()) == sorted(files)
    assert archive.testzip() is None
print(f"Public source ZIP verified: {len(files)} files")
