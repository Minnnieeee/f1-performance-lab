"use strict";

// Product layer: frozen public data, comparison context, methods and exports.
let demoPromise;

async function loadFrozenDemo() {
  stopStreams();
  const generation = state.generation;
  state.selectedMode = "demo";
  state.mode = "replay";
  state.replayLoading = false;
  state.replayError = null;
  syncModeControls();
  try {
    if (!demoPromise) demoPromise = fetch("./data/demo.json").then((response) => {
      if (!response.ok) throw new Error("Frozen dataset could not be loaded.");
      return response.json();
    }).catch((error) => { demoPromise = null; throw error; });
    const demo = await demoPromise;
    if (generation !== state.generation) return;
    state.demo = demo;
    state.mode = "replay";
    state.source = "demo";
    state.token = "";
    state.session = demo.session;
    $("replay-year").value = String(state.replayYear);
    state.sessionCatalog = [demo.session];
    state.drivers = demo.drivers;
    state.laps = demo.laps;
    state.selectedA = 4;
    state.selectedB = 81;
    state.chosenLaps = new Map([[4, 25], [81, 25]]);
    state.sessionContext = { sessionKey: demo.session.session_key, stints: demo.stints || [], pits: demo.pits || [], weather: demo.weather || [], raceControl: demo.raceControl || [], intervals: new Map(), intervalAvailability: new Map() };
    state.events = [];
    $("session-name").textContent = "Silverstone · 2023 · Qualifying / Q3";
    updateSessionOptions();
    updateDriverOptions();
    applyDemoComparison();
  } catch (error) {
    if (generation !== state.generation) return;
    setStatus("error", tr("Example unavailable · retry Open example", "DEMO 불러오기 실패 · DEMO로 재시도"));
    $("access-note").textContent = error.message;
  }
}

function availableComparisonLaps(driver) {
  return (state.source === "demo" ? state.demo.datasets.map((data) => data.lap) : state.laps)
    .filter((lap) => Number(lap.driver_number) === Number(driver) && validLap(lap))
    .sort((a, b) => Number(a.lap_number) - Number(b.lap_number));
}

function applyDemoComparison() {
  if (!state.demo || state.selectedMode !== "demo") return;
  stopStreams();
  state.replayData = new Map();
  for (const driver of [state.selectedA, state.selectedB]) {
    const candidates = state.demo.datasets.filter((data) => Number(data.lap.driver_number) === Number(driver));
    const dataset = candidates.find((data) => Number(data.lap.lap_number) === state.chosenLaps.get(Number(driver))) || [...candidates].sort((a, b) => a.lap.lap_duration - b.lap.lap_duration)[0];
    if (!dataset) return;
    state.chosenLaps.set(Number(driver), Number(dataset.lap.lap_number));
    state.replayData.set(Number(driver), dataset);
  }
  state.telemetry = new Map([...state.replayData].map(([driver, data]) => [driver, data.telemetry]));
  state.locations = new Map([...state.replayData].map(([driver, data]) => [driver, data.locations]));
  state.replayDuration = Math.max(...[...state.replayData.values()].map((data) => data.lap.lap_duration));
  updateDriverOptions();
  updateLapSelectors();
  buildDistancePerformanceAnalysis();
  buildPaceRows();
  updateLabDetails();
  setStatus("preview", "Example · Silverstone 2023 qualifying");
  $("source-label").textContent = tr("Recorded data · 2 drivers / Q3", "동결된 실제 데이터 · 2명 / Q3");
  $("source-label").style.color = "var(--cyan)";
  $("source-label").style.borderColor = "var(--cyan)";
  resetReplayClock();
  render();
}

function updateLapSelectors() {
  for (const [side, driver] of [["a", state.selectedA], ["b", state.selectedB]]) {
    const laps = availableComparisonLaps(driver);
    const selected = state.replayData.get(Number(driver))?.lap;
    $("lap-" + side).innerHTML = laps.map((lap) => `<option value="${Number(lap.lap_number)}">L${Number(lap.lap_number)} · ${Number(lap.lap_duration).toFixed(3)}s${lap.qualifying_segment ? ` · ${esc(lap.qualifying_segment)}` : ""}</option>`).join("");
    if (selected) $("lap-" + side).value = String(selected.lap_number);
  }
}

function lapContext(driver) {
  const data = state.replayData.get(Number(driver));
  const lap = data?.lap;
  if (!lap || !state.session || state.mode !== "replay") return null;
  const stints = Number(state.stintsSessionKey) === Number(state.session.session_key) ? state.stints : state.sessionContext?.stints;
  const stint = stints?.find((item) => Number(item.driver_number) === Number(driver) && lap.lap_number >= item.lap_start && lap.lap_number <= item.lap_end);
  const age = tyreAgeForLap(lap,stint);
  const stintOnly = Number(state.session.year) >= 2026 && !!stints?.length && stints.every(s => numberOrNull(s.tyre_age_at_start) === 0);
  return { lap, compound: lap.compound || stint?.compound || null, age, stintOnly, stint: lap.stint_number ?? stint?.stint_number ?? null, elapsed: (Date.parse(lap.date_start) - Date.parse(state.session.date_start)) / 60_000, interval: trafficIntervalForLap(state.sessionContext?.intervals?.get(Number(driver)), lap) };
}

function sectorChecks() {
  const analysis = state.distanceAnalysis;
  if (!analysis) return [];
  const dataA = state.replayData.get(Number(state.selectedA));
  const dataB = state.replayData.get(Number(state.selectedB));
  let tA = 0, tB = 0;
  const checks = [];
  for (let sector = 1; sector <= 3; sector++) {
    const a = Number(dataA.lap[`duration_sector_${sector}`]), b = Number(dataB.lap[`duration_sector_${sector}`]);
    if (!(a > 0) || !(b > 0)) break;
    tA += a; tB += b;
    const pathA = analysis.lapA.path, pathB = analysis.lapB.path;
    const bounded = tA >= pathA[0].t && tA <= pathA.at(-1).t && tB >= pathB[0].t && tB <= pathB.at(-1).t;
    const pA = bounded ? interpolateField(pathA, tA, "t", "progress") : null;
    const pB = bounded ? interpolateField(pathB, tB, "t", "progress") : null;
    const bt = observedAt(analysis.lapB.path, pA, "t");
    const sampledA = observedAt(analysis.lapA.path, pA, "t");
    const localDelta = bounded ? localDeltaAt(analysis.lapA, analysis.lapB, pA) : null;
    checks.push({ sector, sectorDelta: a - b, cumulativeDelta: tA - tB, progressA: pA, progressB: pB, localDelta, residual: Number.isFinite(localDelta) ? localDelta - (tA - tB) : null });
  }
  return checks;
}

function updateLabDetails() {
  const demo = state.source === "demo";
  syncModeControls();
  $("load-session-model").textContent = demo ? tr("RECALCULATE FROZEN CONTEXT", "동결 데이터 다시 계산") : tr("Load pace & strategy", "PACE & STRATEGY 불러오기");
  const contextA = lapContext(state.selectedA), contextB = lapContext(state.selectedB);
  for (const [side, context] of [["a", contextA], ["b", contextB]]) {
    const unavailable = state.stintsStatus === "error" ? tr("tyre data could not load — retry session", "타이어 정보 로딩 실패 · 세션 다시 불러오기") : tr("not reported", "기록 없음");
    const ageLabel = context?.stintOnly ? tr("laps into stint (total set usage unverified)", "스틴트 내 경과 랩 (세트 총 사용량 미확인)") : tr("source-reported tyre age at lap start", "기록상 랩 시작 시 타이어 사용 랩");
    const interval = !isRaceLikeSession() ? tr("front interval: not provided for practice/qualifying", "앞차 간격: 연습·예선 미제공") : `${tr("sampled front interval", "앞차 표본 간격")} ${Number.isFinite(context?.interval) ? context.interval.toFixed(1) + "s" : state.sessionContext ? tr("not reported", "기록 없음") : tr("load pace context to inspect", "PACE 분석에서 불러오기")}`;
    $("lap-context-" + side).textContent = context ? `L${context.lap.lap_number} · ${context.compound || unavailable} · ${ageLabel} ${context.age ?? "—"} · ${tr("stint", "스틴트")} ${context.stint ?? "—"} · ${tr("session elapsed", "세션 경과")} ${Number.isFinite(context.elapsed) ? context.elapsed.toFixed(1) : "—"}min · ${interval}` : tr("Lap context unavailable", "랩 조건 정보 없음");
  }
  const mismatch = contextA && contextB && (contextA.compound !== contextB.compound || contextA.age !== contextB.age);
  $("comparison-warning").textContent = tr(
    `${demo ? "Frozen subset: two McLaren drivers, two Q3 timed laps each; not the full grid. " : "Manual lap comparison. "}${mismatch ? "WARNING: tyre compound or age differs. " : ""}Fuel load is unobserved; tow is unconfirmed. Interval availability does not establish clean air. Lap start is reconstructed from timing/telemetry, not an independent timing beacon.`,
    `${demo ? "동결 부분집합: McLaren 2명, 각 Q3 주행 랩 2개이며 전체 출전 명단이 아닙니다. " : "수동 랩 비교입니다. "}${mismatch ? "주의: 타이어 종류 또는 사용 랩 수가 다릅니다. " : ""}연료량은 관측 불가, 토우 여부는 미확인입니다. 간격 데이터만으로 클린 에어를 확정할 수 없습니다. 랩 시작시각은 타이밍·텔레메트리로 재구성한 값입니다.`
  );
  const analysis = state.distanceAnalysis;
  if (analysis) {
    const describe = (lap, side) => `${side}: ${(lap.quality.coverage * 100).toFixed(1)}% ${tr("time coverage", "시간 범위")} · ${tr("start/end missing", "시작/끝 누락")} ${lap.quality.startMissing.toFixed(2)}/${lap.quality.endMissing.toFixed(2)}s · ${tr("max gap", "최대 공백")} ${lap.quality.maxGap.toFixed(2)}s · ${tr("rejected", "제외 표본")} ${lap.quality.rejected}`;
    const good = analysis.lapA.quality.usable && analysis.lapB.quality.usable;
    $("alignment-quality").textContent = `${good ? tr("EXPLORATORY: sampling checks passed, not a precision validation.", "탐색용: 표본 점검 통과이며 정밀도 검증은 아닙니다.") : tr("Alignment unavailable: local deltas withheld; reported lap time is retained.", "품질 보류: 구간 시간차는 숨기고 보고된 랩타임은 유지합니다.")} ${describe(analysis.lapA, "A")} | ${describe(analysis.lapB, "B")}`;
    const rows = sectorChecks();
    $("sector-checks").innerHTML = rows.length ? `<table class="analysis-table"><thead><tr><th>${tr("Timing boundary", "타이밍 경계")}</th><th>${tr("Reported sector Δ", "보고된 섹터 Δ")}</th><th>${tr("Reported cumulative Δ", "보고된 누적 Δ")}</th><th>${tr("Position-derived Δ at A boundary", "A 경계에서 위치 유래 Δ")}</th><th>${tr("Consistency residual", "일관성 차이")}</th></tr></thead><tbody>${rows.map((row) => `<tr><td>S${row.sector}</td><td>${signed(row.sectorDelta)}s</td><td>${signed(row.cumulativeDelta)}s</td><td>${signed(row.localDelta, 2)}s</td><td>${signed(row.residual, 2)}s</td></tr>`).join("")}</tbody></table><p class="engineering-note">${tr("Boundaries use cumulative S1, S1+S2, S1+S2+S3 from lap start. Residuals are consistency checks, not independent GPS validation. No endpoint time stretching or forced finish agreement.", "경계는 랩 시작+S1, +S1+S2, +S1+S2+S3입니다. 차이는 일관성 점검이며 독립 GPS 검증이 아닙니다. 시간을 늘이거나 마지막 값을 강제로 맞추지 않습니다.")}</p>` : tr("Reported sector timing is unavailable.", "보고된 섹터 타이밍이 없습니다.");
  } else {
    $("alignment-quality").textContent = tr("Replay lap positions are required. No distance analysis from a live rolling window.", "리플레이 랩 위치 데이터가 필요합니다. 실시간 이동 시간창으로 거리 분석을 만들지 않습니다.");
    $("sector-checks").innerHTML = "";
  }
  renderCase();
  renderMethods();
  if (typeof addCaseEvidence === "function") addCaseEvidence();
  if (typeof renderRaceReplay === "function") renderRaceReplay();
  if (typeof renderSessionPace === "function") renderSessionPace();
}

function replayErrorCopy(error) {
  if (error.code === "access") return tr(
    `OpenF1 refused access (HTTP ${error.status}). During a live session it can restrict historical data too. Retry after the session or choose the free DEMO; REPLAY stays selected.`,
    `OpenF1이 접근을 거부했습니다 (HTTP ${error.status}). 경기 중에는 과거 데이터도 제한될 수 있습니다. 세션 종료 후 다시 시도하거나 무료 DEMO를 선택해주세요. REPLAY 선택은 유지됩니다.`);
  if (error.code === "network") return tr(
    "The browser could not read OpenF1's response (network / CORS). This can happen when live-session access restrictions omit browser permission headers; it can also be a network problem. The exact HTTP status is hidden from the browser. Retry later or choose the free DEMO. REPLAY stays selected.",
    "브라우저가 OpenF1 응답을 읽지 못했습니다 (네트워크 / CORS). 경기 중 접근 제한 응답에 브라우저 허용 헤더가 없거나 네트워크 문제일 수 있습니다. 정확한 HTTP 상태는 브라우저에 전달되지 않습니다. 잠시 후 다시 시도하거나 무료 DEMO를 선택해주세요. REPLAY 선택은 유지됩니다.");
  if (error.code === "timeout") return tr("OpenF1 did not respond within 15 seconds. REPLAY stays selected; retry or choose DEMO.", "OpenF1이 15초 안에 응답하지 않았습니다. REPLAY 선택은 유지됩니다. 재시도하거나 DEMO를 선택해주세요.");
  if (error.code === "rate_limit") return tr("OpenF1's request limit was reached. Wait before retrying. DEMO needs no OpenF1 request.", "OpenF1 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요. DEMO는 OpenF1을 요청하지 않습니다.");
  return tr("The selected replay could not be loaded. Please retry or choose DEMO.", "선택한 리플레이를 불러오지 못했습니다. 재시도하거나 DEMO를 선택해주세요.") + " " + error.message;
}

function syncModeControls() {
  const replay = state.selectedMode === "replay", live = state.selectedMode === "live";
  document.querySelectorAll(".mode-button").forEach((button) => {
    const selected = (button.id === "load-demo" ? "demo" : button.dataset.mode) === state.selectedMode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("replay-year").classList.toggle("hidden", !replay);
  $("replay-session").classList.toggle("hidden", !replay);
  $("session-name").classList.toggle("hidden", replay);
  $("live-controls").classList.toggle("hidden", !live);
  $("lap-comparison").classList.toggle("hidden", live);
  $("driver-a").disabled = $("driver-b").disabled = state.replayLoading || state.drivers.length < 2;
  $("lap-a").disabled = state.replayLoading || !availableComparisonLaps(state.selectedA).length;
  $("lap-b").disabled = state.replayLoading || !availableComparisonLaps(state.selectedB).length;
  $("load-session-model").disabled = state.replayLoading || state.contextLoading || live || !state.replayData.size;
  $("export-json").disabled = $("export-csv").disabled = state.replayLoading || live || !state.distanceAnalysis;
  $("access-note").classList.toggle("hidden", replay);
  $("access-note").textContent = live
    ? tr("LIVE requires a paid OpenF1 token. No file upload is needed; the page must remain open.", "LIVE에는 유료 OpenF1 토큰이 필요합니다. 업로드는 필요 없으며 페이지를 열어두어야 합니다.")
    : replay ? ""
    : "Showing the Silverstone case. Select REPLAY to explore other sessions.";
  const feedbackVisible = replay && (state.replayLoading || !!state.replayError);
  $("replay-feedback").classList.toggle("hidden", !feedbackVisible);
  $("error-open-demo").textContent = "Open example";
  if (feedbackVisible) {
    $("replay-feedback-title").textContent = state.replayLoading ? tr("Loading the selected replay…", "선택한 리플레이를 불러오는 중…") : tr("Replay could not be loaded", "리플레이를 불러오지 못했습니다");
    const previous = state.source === "openf1" && state.session ? tr(` Still showing the last successful load: ${sessionTitle(state.session)}.`, ` 마지막으로 불러온 ${sessionTitle(state.session)} 데이터를 계속 표시합니다.`) : tr(" No replay telemetry has been loaded.", " 아직 리플레이 주행 데이터를 불러오지 못했습니다.");
    $("replay-feedback-detail").textContent = (state.replayLoading ? tr("Your selection is retained. You can open the example at any time.", "선택은 유지됩니다. 언제든 DEMO로 전환할 수 있습니다.") : replayErrorCopy(state.replayError)) + previous;
  } else {
    $("replay-feedback-title").textContent = "";
    $("replay-feedback-detail").textContent = "";
  }
}

function renderCase() {
  const target = $("case-content");
  if (state.source !== "demo" || !state.distanceAnalysis) {
    target.innerHTML = `<h3>${tr("Silverstone 2023 · paired-lap case", "Silverstone 2023 · 두 랩 비교 사례")}</h3><p>${tr("Open example to inspect the frozen case and its evidence. The case is not applied to arbitrary replay or live selections.", "DEMO를 열면 동결된 사례와 근거를 볼 수 있습니다. 이 사례를 다른 리플레이·실시간 선택에 적용하지 않습니다.")}</p>`;
    return;
  }
  const a = state.replayData.get(Number(state.selectedA)).lap;
  const b = state.replayData.get(Number(state.selectedB)).lap;
  const sectors = sectorChecks();
  const biggest = [...sectors].sort((x, y) => Math.abs(y.sectorDelta) - Math.abs(x.sectorDelta))[0];
  const windows = state.distanceAnalysis.corners.filter((row) => Number.isFinite(row.segmentDelta));
  const window = [...windows].sort((x, y) => Math.abs(y.segmentDelta) - Math.abs(x.segmentDelta))[0];
  const speedA=roundedOrNull(window?.apex.speedA) ?? "—",speedB=roundedOrNull(window?.apex.speedB) ?? "—";
  const p = (en, ko) => `<p>${tr(en, ko)}</p>`;
  const h = (en, ko) => `<h3>${tr(en, ko)}</h3>`;
  target.innerHTML = h("Silverstone 2023 · same-team Q3 comparison", "Silverstone 2023 · 같은 팀 Q3 비교")
    + p(`${shortName(state.selectedA)} L${a.lap_number} (${a.lap_duration.toFixed(3)}s) vs ${shortName(state.selectedB)} L${b.lap_number} (${b.lap_duration.toFixed(3)}s). Reported finish Δ A−B: ${signed(a.lap_duration - b.lap_duration)}s. This case updates when you change either lap.`, `${shortName(state.selectedA)} L${a.lap_number} (${a.lap_duration.toFixed(3)}s) 대 ${shortName(state.selectedB)} L${b.lap_number} (${b.lap_duration.toFixed(3)}s). 보고된 최종 Δ A−B: ${signed(a.lap_duration - b.lap_duration)}s. 랩을 바꾸면 사례의 수치도 바뀝니다.`)
    + h("The question", "1 · 문제 정의와 랩 선택")
    + p("Where does the paired lap-time difference accumulate? Same event, Q3 and team reduce some specification and session-phase differences. Compound, tyre age and start-time separation are exposed above; they are not assumed equal. Fuel, setup, wind at the car and tow remain uncontrolled. This is a performance trace comparison, not a ranking of driver skill.", "두 랩의 시간차는 어디서 누적되는가? 같은 대회·Q3·팀을 선택해 차량 사양과 세션 단계 차이 일부를 줄였습니다. 타이어 종류·사용 랩·시작시각은 위에 공개하며 같다고 가정하지 않습니다. 연료·세팅·차량 주변 바람·토우는 통제하지 못했습니다. 드라이버 실력 순위가 아니라 성능 기록 비교입니다.")
    + h("Evidence", "2 · 해석보다 먼저 확인할 근거")
    + p(biggest ? `Largest absolute reported sector difference: S${biggest.sector}, ${signed(biggest.sectorDelta)}s (A−B). Use this timing result to locate the broad loss before interpreting approximate position alignment.` : "Sector timing is unavailable for this pair; do not infer sector losses from the finish difference alone.", biggest ? `보고된 섹터 차이의 절댓값이 가장 큰 곳은 S${biggest.sector}, ${signed(biggest.sectorDelta)}s (A−B)입니다. 근사 위치 정렬을 해석하기 전에 이 타이밍 결과로 큰 손실 구간을 좁힙니다.` : "이 랩 쌍은 섹터 타이밍이 없어 최종 시간차만으로 섹터 손실을 추론하지 않습니다.")
    + p(window ? `Exploratory window Z${window.number}: ${(window.entry.progress * 100).toFixed(1)}–${(window.exit.progress * 100).toFixed(1)}% of A-reference progress, Δ change ${signed(window.segmentDelta, 2)}s; speed at shared minimum ${speedA} / ${speedB}km/h. This window includes neighbouring straight portions. Check the sector consistency table before attributing a local loss.` : "Local windows are withheld because the location-quality gate was not met.", window ? `탐색 구간 Z${window.number}: A 기준 진행률 ${(window.entry.progress * 100).toFixed(1)}–${(window.exit.progress * 100).toFixed(1)}%, Δ 변화 ${signed(window.segmentDelta, 2)}s, 공통 최저속도 지점의 속도 ${speedA} / ${speedB}km/h. 주변 직선 일부를 포함하므로 국소 손실을 주장하기 전 섹터 일관성 표를 확인해야 합니다.` : "위치 품질 기준을 통과하지 못해 구간 비교를 보류했습니다.")
    + h("Interpretation", "3 · 가능한 메커니즘과 한계")
    + p("A lower speed during a braking window is compatible with earlier deceleration, a different approach speed or an alignment error. A loss growing after the minimum can reflect throttle timing or straight-line performance; it is not proof of tyre grip loss. Compare brake ON, throttle recovery and raw DRS together. Derived ax is a smoothed speed derivative, not measured brake force or tyre force.", "제동 구간의 낮은 속도는 더 이른 감속·다른 진입 전 속도·정렬 오차와 모두 양립합니다. 최저속도 이후 커지는 손실은 스로틀 회복이나 직선 성능과 관련될 수 있지만 타이어 그립 저하의 증거는 아닙니다. 브레이크 ON·스로틀 회복·DRS 원채널을 함께 확인합니다. ax는 평활한 속도 미분이며 브레이크 힘·타이어 힘 실측이 아닙니다.")
    + h("Engineering decision", "4 · 공학적 판단")
    + p("Compare the reported sectors with sampled speed and input transitions. The fixed case follow-up found a smaller minimum-speed difference on L22 while its S1 result reversed; the L25 mechanism is not established as repeatable. No setup or tyre-pressure recommendation follows from these public channels.", "");
}

function renderMethods() {
  const section = (enTitle, koTitle, en, ko) => `<h3>${tr(enTitle, koTitle)}</h3><p>${tr(en, ko)}</p>`;
  $("methods-content").innerHTML = section("Data and provenance", "데이터와 출처",
    "DEMO is a frozen extract of the official Formula 1 historical timing archive, parsed with FastF1. It loads from this website, not the OpenF1 API. Only two McLaren drivers' selected 2023 Silverstone Q3 laps are bundled. Source URLs, parsing version, sample selection and timing limitations are included in the downloadable JSON. Historical replay and paid live connections use OpenF1. Software licensing is not a claim of ownership of Formula 1 data; this is an unofficial educational analysis.",
    "DEMO는 Formula 1 공식 과거 타이밍 아카이브를 FastF1으로 읽어 동결한 부분집합입니다. OpenF1 API가 아니라 이 사이트에서 불러옵니다. 2023 Silverstone Q3 McLaren 2명의 선택 랩만 포함합니다. 출처 URL·파서 버전·표본 선택·타이밍 한계는 JSON에 담았습니다. 과거 세션 리플레이와 유료 라이브 연결은 OpenF1을 사용합니다. 소프트웨어 라이선스가 F1 데이터 소유권을 뜻하지 않으며 비공식 교육용 분석입니다.")
    + section("Telemetry and alignment", "01–06 · 그래프·현재값·입력·위치·요약·이벤트",
    "Replay defaults to the same estimated progress for speed, throttle, binary brake, local delta and map cursor. Drag to zoom; use numeric From/To or arrow keys without a mouse. Time view retains lap-relative seconds, not simultaneous wall-clock positions. LIVE shows 60 seconds. Speed Δ=A−B is km/h, not time gap. Transition locations are brackets between native samples; throttle recovery is the first crossing to ≥95% after the selected minimum. Minimum speed is not a geometric apex. Full throttle in the secondary summary is a sample fraction, not time weighted. Live events are not invented for replay.",
    "리플레이는 속도·스로틀·이진 브레이크·국소 Δ·지도 커서를 동일 추정 진행도에 맞춥니다. 드래그 확대, 숫자 시작/끝 입력, 방향키 이동을 지원합니다. 시간 보기는 랩 경과초이며 동일 실제 시각 비교가 아닙니다. LIVE는 60초 시간창입니다. 속도 Δ=A−B는 km/h이며 시간 간격이 아닙니다. 전환 지점은 원래 인접 표본 사이 범위입니다. 스로틀 회복은 선택 최저속도 이후 첫 ≥95% 전환이며 최저속도는 기하학적 apex가 아닙니다. 보조 요약의 풀스로틀 비율은 표본 비율이지 시간 가중 비율이 아닙니다. 리플레이에서 실시간 이벤트를 만들지 않습니다.")
    + section("Distance · definition and quality gate", "Distance · 정의와 품질 기준",
    "Position coordinates have no assumed metre scale. Five-point coordinate medians and a jump threshold of six times the median positive step remove obvious outliers. A's accumulated path defines normalized progress; B is projected to nearby segments within ±6% initial progress. Small backward projections are made monotone. Original lap-relative timestamps are retained. Local Δt(p)=tA(p)−tB(p), positive when A takes longer. Finish Δ is the separately reported lap-duration difference. Max A gain=max(0,−min Δ); max A loss=max(0,max Δ), over valid sampled progress. Position samples=min(accepted A, accepted B), not a precision score. Local deltas require ≥98% temporal span, ≤2s internal gap, ≤1.2s missing at each end, and ≤5% backward projections; these are engineering guardrails, not validated error bounds. No extrapolation beyond common progress, no forced endpoint agreement. Sector crossings are cumulative times from the lap start; residuals expose timing/position inconsistency without independently validating either source.",
    "위치 좌표에 미터 단위를 가정하지 않습니다. 5점 좌표 중앙값과 양의 이동거리 중앙값의 6배 점프 기준으로 큰 이상값을 제외합니다. A 누적 경로를 진행률로 정규화하고 B를 초기 진행률 ±6% 안의 가까운 선분에 투영합니다. 작은 역방향 투영은 단조화하되 원래 랩 상대시각을 유지합니다. Δt(p)=tA(p)−tB(p)이며 양수면 A 소요시간이 더 깁니다. 최종 Δ는 별도로 보고된 랩타임 차이입니다. Max A gain=max(0,−최소 Δ), Max A loss=max(0,최대 Δ)이며 유효 표본 범위에서 계산합니다. Position samples=min(A 유효 표본,B 유효 표본)이며 정밀도 점수가 아닙니다. 구간 Δ 조건은 시간 범위≥98%, 내부 공백≤2초, 양끝 누락 각각≤1.2초, 역방향 투영≤5%입니다. 검증된 오차범위가 아닌 사용 제한 기준입니다. 공통 진행률 밖 외삽·마지막 시간 강제 일치를 하지 않습니다. 섹터 경계는 랩 시작부터의 누적시간이고 차이는 두 원천의 일관성을 보여줄 뿐 독립 검증이 아닙니다.")
    + section("Speed zones, DRS and acceleration", "속도 구간·DRS·가속도",
    "Z1… are automatically detected speed-minimum zones, not official corner numbers or geometric apexes. Midpoint-to-midpoint windows include straights. Input labels use the final 1.5% of reference progress before the minimum, clipped to the zone. BRAKING means a brake-ON sample in that window; LIFT means throttle below 95% without brake ON; otherwise FLAT / UNKNOWN. Absence of a detected minimum does not mean no corner. DRS is shown as the raw channel: for 2023–2025, 10/12/14 denote activation in OpenF1's legacy mapping; 0/1 are off and 8 eligible. For 2026 the semantics are unverified here and must not be called Boost or Overtake. ax is the slope of speed/3.6 versus time over ±0.5s (≥3 samples); it includes speed quantisation and smoothing, not direct acceleration sensing.",
    "Z1…은 자동 최저속도 구간이며 공식 코너 번호·기하학적 apex가 아닙니다. 인접 최저점의 중간점 사이에는 직선도 포함합니다. 입력 분류는 최저점 전 기준 진행률 1.5% 구간으로 제한합니다. 해당 창에서 브레이크 ON 표본이 있으면 BRAKING, 없고 스로틀<95%면 LIFT, 그 외는 FLAT / UNKNOWN입니다. 최저점 미탐지가 코너 부재를 뜻하지 않습니다. DRS는 원채널을 표시합니다. 2023–2025 legacy 매핑에서 10/12/14는 작동, 0/1은 OFF, 8은 사용 가능이며 2026 의미는 여기서 검증되지 않아 Boost·Overtake로 부르지 않습니다. ax는 ±0.5초의 속도/3.6 대 시간 기울기(최소 3표본)로, 양자화·평활 영향이 있는 파생값이지 직접 가속도 센서값이 아닙니다.")
    + section("Stint & tyre · what the model does", "Stint & tyre · 모델 범위",
    "Usable laps exclude pit-out, recorded pit laps, laps >8% slower than the stint best, and race laps with a sampled front interval <1.5s. Missing intervals are unknown, not clean air. Pace-age slope is a descriptive within-stint fit, not pure tyre degradation. Corrected time=raw+assumed fuel gain×(race lap−1)−session-trend×elapsed hours. Race trend is not separated from fuel and tyres. Non-race trend is a driver-centred session proxy, not a causal track evolution measurement; it is disabled for the small frozen demo. R² measures in-sample fit, not predictive accuracy. Rainfall reports do not establish a dry or wet racing surface. Tyre age follows source convention and is not a measured wear state.",
    "유효 랩은 피트 아웃·기록된 피트 랩·stint 최선보다 8% 초과 느린 랩·앞차 표본 간격<1.5초인 레이스 랩을 제외합니다. 간격 누락은 클린 에어가 아니라 미확인입니다. Pace-age slope는 stint 안의 기술적 기울기이며 순수 타이어 열화가 아닙니다. 보정시간=원시간+가정 연료효과×(레이스 랩−1)−세션 추세×경과시간입니다. 레이스 추세는 연료·타이어와 분리하지 않습니다. 비레이스 추세도 드라이버 중심 세션 프록시이지 인과적 노면 개선 측정이 아니며 작은 동결 데모에서는 꺼둡니다. R²는 표본 내 적합도이지 예측 정확도가 아닙니다. 강수 보고로 노면 건조·젖음을 단정하지 않습니다. 타이어 사용 랩은 원천 정의를 따르며 마모 실측이 아닙니다.")
    + section("Strategy · scenario, not recommendation", "Strategy · 권고가 아닌 시나리오",
    "Race stints only. Linear pace(age)=fitted intercept+slope×age; age resets to zero at the one same-compound change. Compare delaying by D laps against stopping now over H laps. Positive delayed−now means now is quicker only under these assumptions. Identical pit loss, fuel and common warm-up penalty cancel. SC saving=green pit loss×(1−SC factor), likewise VSC; these are counterfactuals, not measured savings. Fresh-tyre pace advantage compares A fresh pace plus assumed warm-up with B old pace. It does not include actual gap, pit traffic, physical out-lap or position reversal. SC/VSC message counts are not deployment counts. Sparse or negative pace slopes can be dominated by traffic, warm-up or changing conditions.",
    "레이스 stint만 사용합니다. 선형 pace(age)=절편+기울기×사용 랩이며 같은 컴파운드로 한 번 바꾸면 사용 랩을 0으로 둡니다. H랩 안에서 지금 정차와 D랩 지연 정차를 비교하고 지연−지금이 양수면 이 가정에서만 지금이 빠릅니다. 같은 피트 손실·연료항·공통 워밍업 패널티는 상쇄됩니다. SC 절감=정상 피트 손실×(1−SC 배율), VSC도 동일하며 실제 절감 실측이 아닌 가정입니다. Fresh-tyre pace advantage는 A 신품 pace+워밍업 가정과 B 구품 pace를 비교합니다. 실제 간격·피트 트래픽·물리적 아웃랩·순위 역전을 포함하지 않습니다. SC/VSC 메시지 수는 개입 횟수가 아닙니다. 희소하거나 음수인 기울기는 교통·워밍업·조건 변화 영향일 수 있습니다.")
    + section("Prediction validation and reproducibility", "",
    "The historical check compares this dashboard's regression with a recent-three-lap mean, using only pre-cutoff fit data. The four existing race datasets cover selected drivers, not a representative field sample. Eligible outcomes and withheld forecasts are both counted. Replacement-stint checks cannot establish the counterfactual result of a different stop schedule. Read the Model validation tab and the downloadable report for measured errors and scope. JSON exports observations, derived metrics, assumptions and provenance without credentials; CSV exports the shared-progress comparison. Source download includes the checks and frozen inputs.", "")
    + `<p><a href="https://livetiming.formula1.com/static/2023/2023-07-09_British_Grand_Prix/2023-07-08_Qualifying/SessionInfo.json" target="_blank" rel="noreferrer">Formula 1 historical session</a> · <a href="https://docs.fastf1.dev/" target="_blank" rel="noreferrer">FastF1</a> · <a href="https://openf1.org/docs/" target="_blank" rel="noreferrer">OpenF1</a></p>`;
}

function buildExportPayload() {
  if(typeof flushPendingStrategyInputUpdate==='function')flushPendingStrategyInputUpdate();
  const analysis = state.distanceAnalysis;
  if(!analysis) return null;
  return { schema_version: 2, source: state.source, exported_at: new Date().toISOString(), session: state.session, display:telemetrySnapshot(), provenance: state.source === "demo" ? state.demo.provenance : { api: API_BASE }, observations: [...state.replayData.entries()].filter(([driver]) => driver === state.selectedA || driver === state.selectedB).map(([driver, data]) => ({ driver, ...data })), derived: { progress_axis: "A reference approximate path; dimensionless; timestamps unchanged", grid: analysis.grid, reported_finish_delta: analysis.finishDelta, qualityA: analysis.lapA.quality, qualityB: analysis.lapB.quality, sectors: sectorChecks(), zones: analysis.corners, pace_rows: state.paceRows }, assumptions: strategyInputs(), race_scenario:typeof raceExportPayload==="function"?raceExportPayload():null, limitations: "Exploratory public telemetry; no measured fuel, tyre force, temperature, or grip. Sector residuals are not independent validation." };
}

function exportAnalysis(format) {
  if (!state.distanceAnalysis || state.mode === "live") { toast(tr("Load two replay laps before exporting.", "리플레이 두 랩을 먼저 불러와주세요.")); return; }
  const analysis=state.distanceAnalysis, payload=buildExportPayload();
  const columns = ["progress", "tA", "tB", "delta", "speedA", "speedB", "throttleA", "throttleB", "brakeA", "brakeB"];
  const content = format === "json" ? JSON.stringify(payload, null, 2) : columns.join(",") + "\r\n" + analysis.grid.map((row) => columns.map((column) => Number.isFinite(row[column]) ? row[column] : "").join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `min-annie-ji-${state.session.session_key}-A${state.selectedA}-B${state.selectedB}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("load-demo").addEventListener("click", () => loadFrozenDemo());
$("error-open-demo").addEventListener("click", () => loadFrozenDemo());
$("open-featured-case").addEventListener("click", async () => {
  await loadFrozenDemo();
  if (state.source !== "demo" || state.selectedMode !== "demo" || !state.demo) return;
  state.selectedA = 4;
  state.selectedB = 81;
  state.chosenLaps.set(4, 25);
  state.chosenLaps.set(81, 25);
  applyDemoComparison();
  setProgressWindow(.136, .272);
  document.querySelector(".trace-stack").scrollIntoView({ behavior: "smooth" });
});
document.addEventListener("click", (event) => {
  if (event.target.closest('a[href="#methodology"]')) $("methodology").open = true;
});
$("replay-year").addEventListener("change", async () => {
  if (state.selectedMode !== "replay") return;
  state.replayYear = Number($("replay-year").value);
  state.sessionCatalog = [];
  state.chosenLaps.clear();
  await loadReplay({ force: true, skipCache: true });
});
for (const [side, driverKey] of [["a", "selectedA"], ["b", "selectedB"]]) {
  $("lap-" + side).addEventListener("change", async () => {
    state.chosenLaps.set(Number(state[driverKey]), Number($("lap-" + side).value));
    if (state.source === "demo") applyDemoComparison();
    else { await loadReplay({ skipCache: true }); if (state.sessionContext) buildPaceRows(); }
  });
}
$("export-json").addEventListener("click", () => exportAnalysis("json"));
$("export-csv").addEventListener("click", () => exportAnalysis("csv"));

// Retire the previous language preference, including for returning visitors.
try { localStorage.removeItem("performance-lab-language"); } catch (_) { /* storage is optional */ }
buildDistancePerformanceAnalysis();
buildPaceRows();
updateLabDetails();
render();
loadFrozenDemo();
