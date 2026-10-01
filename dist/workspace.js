"use strict";

// One shared, dimensionless A-reference progress axis. Reported timing stays
// separate from position-derived local differences; no fitting to timing gates.
let workspaceReady = false;
let workspaceStamp = null;
let tracePointsCache = null;
let linkedMapProject = null;

function linkedTraceActive() { return workspaceReady && state.mode === "replay" && state.traceAxis === "progress" && !!state.distanceAnalysis; }
function progressText(value, digits = 1) { return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—"; }
function clippedProgress(p) { return Math.max(state.progressWindow[0], Math.min(state.progressWindow[1], p)); }
function progressX(p) { return (p - state.progressWindow[0]) / (state.progressWindow[1] - state.progressWindow[0]) * 1000; }

function alignedPoint(progress) {
  const analysis = state.distanceAnalysis;
  if (!analysis) return null;
  const point = { progress };
  for (const side of ["A", "B"]) {
    const lap = analysis[`lap${side}`];
    point[`t${side}`] = observedAt(lap.path, progress, "t");
    point[`speed${side}`] = observedAt(lap.telemetry, progress, "speed");
    point[`throttle${side}`] = observedAt(lap.telemetry, progress, "throttle");
    const support = progressSupport(lap.telemetry, progress);
    point[`brake${side}`] = Number.isFinite(point[`t${side}`]) && support && !support.ambiguous && support.gap <= 2 ? latestSample(lap.telemetry, point[`t${side}`])?.brake ?? null : null;
  }
  point.delta = localDeltaAt(analysis.lapA, analysis.lapB, progress);
  return point;
}

// This exact sample drives both the visible readout and the read-only query.
function alignedCursorSample(side, point) {
  const lap=state.distanceAnalysis?.[`lap${side}`], t=point?.[`t${side}`];
  if(!lap || !Number.isFinite(t)) return null;
  const support=progressSupport(lap.telemetry,point.progress);
  if(!support || support.ambiguous || support.gap>2) return null;
  const native=nearestSample(lap.telemetry,t);
  return native ? {...native,t,speed:point[`speed${side}`],throttle:point[`throttle${side}`],brake:point[`brake${side}`]} : null;
}

function tracePath(points, field, height, maxY, centred = false, step = false) {
  let drawing = false;
  return points.map(point => {
    const value = point[field];
    if (!Number.isFinite(value)) { drawing = false; return ""; }
    const x = progressX(point.progress), y = centred ? height / 2 - value / maxY * height * .45 : height - Math.max(0, Math.min(maxY, value)) / maxY * height;
    const command = drawing ? (step ? `H${x.toFixed(2)} V` : `L${x.toFixed(2)},`) : `M${x.toFixed(2)},`;
    drawing = true;
    return command + y.toFixed(2);
  }).join(" ");
}

function selectedTracePoints() {
  const [start, end] = state.progressWindow;
  const analysis=state.distanceAnalysis;
  if (tracePointsCache?.analysis===analysis && tracePointsCache.start===start && tracePointsCache.end===end) return tracePointsCache.points;
  // Include native telemetry breakpoints: braking edges must not be shifted to
  // the coarser export grid. Extra points are interpolants, not extra observations.
  const gaps=[];
  for (const lap of [analysis.lapA,analysis.lapB]) for(let i=1;i<lap.path.length;i++) {
    const a=lap.path[i-1],b=lap.path[i];
    if(b.t-a.t>lap.quality.localGapLimit || b.progress===a.progress) gaps.push(a.progress,(a.progress+b.progress)/2,b.progress);
  }
  const progress=[...new Set([start,end,...gaps,...analysis.grid.map(p=>p.progress),...analysis.lapA.telemetry.map(p=>p.progress),...analysis.lapB.telemetry.map(p=>p.progress)])].filter(p=>p>=start&&p<=end).sort((a,b)=>a-b);
  const points=progress.map(alignedPoint);
  tracePointsCache={analysis,start,end,points};
  return points;
}

function setProgressWindow(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const lo = Math.max(0, Math.min(1, Math.min(start, end))), hi = Math.max(0, Math.min(1, Math.max(start, end)));
  if (hi - lo < .005) { toast(tr("Choose at least 0.5% of a lap. This is an approximate axis.", "최소 0.5% 구간을 선택하세요. 근사 진행도축입니다.")); return; }
  state.traceAxis = "progress";
  state.progressWindow = [lo, hi];
  state.cursorProgress = (lo + hi) / 2;
  playback.playing = false;
  syncPlaybackToInspection();
  state.tracePointer = null;
  clearChartHover();
  workspaceStamp = null;
  render();
}

function focusSector(sector) {
  const checks = sectorChecks();
  const start = sector === 1 ? 0 : checks[sector - 2]?.progressA;
  const end = sector === 3 ? 1 : checks[sector - 1]?.progressA;
  if (!Number.isFinite(start) || !Number.isFinite(end)) { toast(tr("Position support for this timing boundary is unavailable.", "이 타이밍 경계의 위치 근거가 부족합니다.")); return; }
  setProgressWindow(start, end);
  document.querySelector(".trace-stack").scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleLinkedPointer(event, name) {
  if (!linkedTraceActive()) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
  const p = state.progressWindow[0] + f * (state.progressWindow[1] - state.progressWindow[0]);
  state.cursorProgress = p;
  syncPlaybackToInspection();
  state.tracePointer = { name, fraction: f, top: Math.max(15, event.clientY - rect.top) };
  if (state.traceDrag) state.traceDrag.end = p;
  render();
}

function clearLinkedPointer(force = false) {
  if (!workspaceReady || state.traceDrag || (state.tracePointer?.keyboard && force !== true)) return;
  state.tracePointer = null;
  ["speed", "input", "brake", "linked-delta"].forEach(name => $(`${name}-tooltip`)?.classList.add("hidden"));
}

function initLinkedChart(id, name, existing = false) {
  const chart = $(id);
  chart.setAttribute("tabindex", "0");
  if (!existing) {
    chart.addEventListener("pointermove", event => handleLinkedPointer(event, name));
    chart.addEventListener("pointerleave", clearLinkedPointer);
  }
  chart.addEventListener("pointerdown", event => {
    if (!linkedTraceActive() || event.button !== 0) return;
    handleLinkedPointer(event, name);
    state.traceDrag = { start: state.cursorProgress, end: state.cursorProgress };
    chart.setPointerCapture(event.pointerId);
  });
  chart.addEventListener("pointerup", event => {
    const drag = state.traceDrag;
    if (!drag) return;
    state.traceDrag = null;
    if (chart.hasPointerCapture(event.pointerId)) chart.releasePointerCapture(event.pointerId);
    if (Math.abs(drag.end - drag.start) >= .005) setProgressWindow(drag.start, drag.end);
    else render();
  });
  chart.addEventListener("pointercancel", () => { state.traceDrag = null; clearLinkedPointer(); render(); });
  chart.addEventListener("dblclick", () => { if (state.mode === "replay") setProgressWindow(0, 1); });
  chart.addEventListener("keydown", event => {
    if (!linkedTraceActive()) return;
    if (event.key === "Escape") { setProgressWindow(0, 1); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const [start, end] = state.progressWindow;
    state.cursorProgress = event.key === "Home" ? start : event.key === "End" ? end : clippedProgress(state.cursorProgress + (event.key === "ArrowRight" ? 1 : -1) * (end - start) / 100);
    playback.playing = false;
    syncPlaybackToInspection();
    state.tracePointer = { name, fraction: (state.cursorProgress - start) / (end - start), top: 40, keyboard: true };
    render();
  });
  const svgNS = "http://www.w3.org/2000/svg";
  for (const kind of ["support-bands", "selection-band"]) {
    const g = document.createElementNS(svgNS, "g");
    g.classList.add(kind);
    chart.insertBefore(g, chart.firstChild);
  }
}

function chartPanel(name, title, unit, height, paths) {
  const panel = document.createElement("section");
  panel.className = `panel ${name}-panel linked-only`;
  panel.innerHTML = `<div class="panel-heading compact"><h2 id="${name}-title">${title}</h2><span class="chart-unit">${unit}</span></div><div class="linked-chart-wrap"><svg id="${name}-chart" viewBox="0 0 1000 ${height}" preserveAspectRatio="none" role="img" aria-label="${title}"><g class="chart-grid"><line x1="0" y1="${height/2}" x2="1000" y2="${height/2}"/></g>${paths}<line id="${name}-cursor" class="time-cursor" y1="0" y2="${height}"/></svg><div id="${name}-tooltip" class="chart-tooltip hidden"></div><div class="shared-x-labels mono"></div></div>`;
  return panel;
}

function setupWorkspace() {
  const main = document.querySelector(".dashboard-grid");
  const stack = document.createElement("div"), side = document.createElement("aside");
  stack.className = "trace-stack"; side.className = "trace-sidebar";
  stack.append(document.querySelector(".speed-panel"), document.querySelector(".inputs-panel"));
  stack.append(chartPanel("brake", "Brake ON / OFF", "A upper / B lower · binary", 70, '<path id="brake-line-a" class="trace trace-a"></path><path id="brake-line-b" class="trace trace-b"></path>'));
  stack.append(chartPanel("linked-delta", "Position-derived Δt · exploratory", "A − B · s", 150, '<path id="linked-delta-path" class="distance-delta-path"></path>'));
  const deltaLabels=document.createElement("div");deltaLabels.className="linked-delta-y mono";deltaLabels.innerHTML='<span id="linked-y-max"></span><span>0</span><span id="linked-y-min"></span>';
  stack.querySelector(".linked-delta-panel .linked-chart-wrap").append(deltaLabels);
  const deltaNote = document.createElement("p"); deltaNote.id = "trace-quality-note"; deltaNote.className = "trace-quality-note"; stack.append(deltaNote);
  side.append(document.querySelector(".track-panel"), document.querySelector(".live-readout-panel"));
  const selection = document.createElement("section"); selection.className = "selection-results panel"; selection.id = "selection-results";
  stack.append(selection);
  const lower = document.createElement("details"); lower.className = "secondary-readouts"; lower.innerHTML = '<summary id="secondary-label">Lap / window summary &amp; live events</summary><div class="secondary-grid"></div>';
  lower.querySelector("div").append(document.querySelector(".engineering-panel"), document.querySelector(".event-panel"));
  main.append(stack, side);
  document.querySelector(".analysis-lab").after(lower);
  for (const name of ["speed", "input"]) {
    const labels = document.createElement("div"); labels.className = "shared-x-labels mono";
    $(`${name}-chart`).parentElement.append(labels);
  }
  $("input-chart").querySelectorAll(".brake-bands").forEach(node => node.classList.add("legacy-brake"));
  [["speed-chart", "speed", true], ["input-chart", "input", true], ["brake-chart", "brake"], ["linked-delta-chart", "linked-delta"]].forEach(args => initLinkedChart(...args));
  $("open-linked-traces").addEventListener("click",()=>{state.traceAxis="progress";setPlaybackTime(state.replayCursor);render();document.querySelector(".linked-delta-panel").scrollIntoView({behavior:"smooth",block:"center"});});
  $("axis-progress").addEventListener("click", () => { state.traceAxis = "progress"; setPlaybackTime(state.replayCursor); workspaceStamp = null; render(); });
  $("axis-time").addEventListener("click", () => { state.traceAxis = "time"; clearLinkedPointer(true); clearChartHover(); renderDistancePerformanceAnalysis(); workspaceStamp = null; render(); });
  $("apply-range").addEventListener("click", () => {
    const start=numberOrNull($("range-from").value),end=numberOrNull($("range-to").value);
    if(start===null||end===null) {toast(tr("Enter both interval boundaries.","구간의 시작과 끝을 모두 입력하세요."));return;}
    setProgressWindow(start/100,end/100);
  });
  $("reset-range").addEventListener("click", () => setProgressWindow(0, 1));
  workspaceReady = true;
  render();
}

function paintSupport(chart, height) {
  const analysis = state.distanceAnalysis;
  const [start, end] = state.progressWindow;
  const intervals = [];
  for (const lap of [analysis.lapA, analysis.lapB]) {
    for (let i = 1; i < lap.path.length; i++) {
      const a = lap.path[i-1], b = lap.path[i];
      if (b.t - a.t <= lap.quality.localGapLimit || b.progress < start || a.progress > end) continue;
      intervals.push([Math.max(start, a.progress), Math.min(end, b.progress)]);
    }
  }
  chart.querySelector(".support-bands").innerHTML = intervals.map(([a,b]) => `<rect x="${progressX(a)}" y="0" width="${Math.max(1,progressX(b)-progressX(a))}" height="${height}"/>`).join("");
  const drag = state.traceDrag;
  chart.querySelector(".selection-band").innerHTML = drag ? `<rect x="${progressX(Math.min(drag.start,drag.end))}" y="0" width="${Math.abs(progressX(drag.end)-progressX(drag.start))}" height="${height}"/>` : "";
}

function drawLinkedMap(point, redraw = true) {
  const analysis = state.distanceAnalysis;
  if (redraw || !linkedMapProject) {
  const all = [...analysis.lapA.path, ...analysis.lapB.path];
  const minX = Math.min(...all.map(p=>p.x)), maxX = Math.max(...all.map(p=>p.x));
  const minY = Math.min(...all.map(p=>p.y)), maxY = Math.max(...all.map(p=>p.y));
  const scale = Math.min(540 / Math.max(1,maxX-minX), 300 / Math.max(1,maxY-minY));
  const map = p => ({ x: (600-(maxX-minX)*scale)/2+(p.x-minX)*scale, y: 350-((350-(maxY-minY)*scale)/2+(p.y-minY)*scale) });
  const path = points => points.map((p,i) => { const m=map(p); return `${i ? "L" : "M"}${m.x.toFixed(1)},${m.y.toFixed(1)}`; }).join(" ");
  $("track-empty").classList.add("hidden");
  $("track-base").setAttribute("d", path(analysis.lapA.path));
  for (const side of ["a","b"]) $("track-path-"+side).setAttribute("d", path(analysis[side === "a" ? "lapA" : "lapB"].path));
  const selected = analysis.lapA.path.filter(p=>p.progress>=state.progressWindow[0]&&p.progress<=state.progressWindow[1]);
  $("track-selection").setAttribute("d",state.progressWindow[0]>0||state.progressWindow[1]<1 ? path(selected) : "");
  linkedMapProject = map;
  }
  for (const side of ["a","b"]) {
    const lap = analysis[side === "a" ? "lapA" : "lapB"];
    const x=observedAt(lap.path,point.progress,"x"), y=observedAt(lap.path,point.progress,"y");
    const m=Number.isFinite(x)&&Number.isFinite(y) ? linkedMapProject({x,y}) : {x:-20,y:-20};
    $("car-marker-"+side).setAttribute("cx",m.x); $("car-marker-"+side).setAttribute("cy",m.y);
  }
}

function renderLinkedTooltip(point) {
  for (const name of ["speed","input","brake","linked-delta"]) $(`${name}-tooltip`).classList.add("hidden");
  const hover = state.tracePointer;
  if (!hover) return;
  const tooltip = $(`${hover.name}-tooltip`);
  const value = v => Number.isFinite(v) ? Math.round(v) : "—";
  const ab = field => `${shortName(state.selectedA)} ${value(point[field+"A"])} / ${shortName(state.selectedB)} ${value(point[field+"B"])}`;
  const description = hover.name === "speed" ? `${ab("speed")}km/h` : hover.name === "input" ? `${ab("throttle")}%` : hover.name === "brake" ? `A ${point.brakeA == null ? "—" : point.brakeA > 0 ? "ON" : "OFF"} / B ${point.brakeB == null ? "—" : point.brakeB > 0 ? "ON" : "OFF"}` : `Y Δt ${signed(point.delta,2)}s · ${tr("exploratory", "탐색용")}`;
  tooltip.textContent = `X ${progressText(point.progress)} · ${description}`;
  tooltip.style.left = `${Math.max(15,Math.min(85,hover.fraction*100))}%`;
  tooltip.style.top = `${hover.top}px`;
  tooltip.classList.remove("hidden");
}

function selectionMetrics(lap, start, end) {
  const samples = lap.telemetry.filter(p => p.progress >= start && p.progress <= end && Number.isFinite(p.speed));
  const minimum = samples.reduce((best,p) => !best || p.speed < best.speed ? p : best, null);
  const transitions = (field, test, after = start) => {
    for (let i=1;i<lap.telemetry.length;i++) {
      const a=lap.telemetry[i-1], b=lap.telemetry[i];
      if (a.progress < start || b.progress > end || b.progress < after || b.t-a.t>2) continue;
      if (Number.isFinite(a[field]) && Number.isFinite(b[field]) && test(a[field],b[field])) return [a.progress,b.progress];
    }
    return null;
  };
  return { minimum, count:samples.length, brake:transitions("brake",(a,b)=>a===0&&b>0), throttle:minimum ? transitions("throttle",(a,b)=>a<95&&b>=95,minimum.progress) : null };
}

function renderSelection() {
  const analysis=state.distanceAnalysis, [start,end]=state.progressWindow;
  const a=alignedPoint(start), b=alignedPoint(end), points=selectedTracePoints();
  const continuous=localDeltaRangeSupported(analysis.lapA,analysis.lapB,start,end)&&points.every(p=>Number.isFinite(p.delta));
  const change=continuous&&Number.isFinite(a.delta)&&Number.isFinite(b.delta) ? b.delta-a.delta : null;
  const duration=side=>Number.isFinite(a["t"+side])&&Number.isFinite(b["t"+side]) ? (b["t"+side]-a["t"+side]).toFixed(2) : "—";
  const edge=range=>range ? `${progressText(range[0])}–${progressText(range[1])}` : tr("Not observed in selection", "선택 구간에서 관측되지 않음");
  $("selection-results").innerHTML=`<div class="panel-heading"><h2>${tr("Selected interval", "선택 구간")} · ${progressText(start)}–${progressText(end)}</h2><span class="approx-badge">${tr("Estimated", "탐색용")}</span></div><p class="selection-delta">${tr("Local Δ change · A − B", "구간 Δ 변화 · A − B")}: <strong>${signed(change,2)}s</strong> <small>${continuous ? tr("Not a precision loss measurement", "정밀한 손실 측정값이 아님") : tr("Withheld: missing boundary or sparse position interval", "경계 누락 또는 희소 위치 구간으로 표시 보류")}</small></p><div class="table-scroll"><table class="analysis-table"><thead><tr><th>${tr("Driver", "드라이버")}</th><th>${tr("Position-derived duration", "위치 유래 소요시간")}</th><th>${tr("Minimum sampled speed", "표본 최저속도")}</th><th>${tr("First brake onset bracket", "첫 제동 시작 표본 구간")}</th><th>${tr("First ≥95% throttle after minimum", "최저속도 이후 첫 ≥95% 회복")}</th></tr></thead><tbody>${[["A",analysis.lapA,state.selectedA],["B",analysis.lapB,state.selectedB]].map(([side,lap,driver])=>{const m=selectionMetrics(lap,start,end);return `<tr><td>${shortName(driver)}</td><td>${duration(side)}s</td><td>${m.minimum ? `${Math.round(m.minimum.speed)}km/h @ ${progressText(m.minimum.progress)}` : "—"}</td><td>${edge(m.brake)}</td><td>${edge(m.throttle)}</td></tr>`;}).join("")}</tbody></table></div><p class="engineering-note">${tr("Transition positions are sample brackets; minimum speeds are sampled values. See Methodology for definitions.", "전환 위치는 인접 표본 사이의 범위이며 정확한 지점이 아닙니다. 왼쪽 경계에서 이미 ON인 브레이크를 새 제동 시작으로 세지 않습니다. 최저속도는 기하학적 apex가 아니며 ≥95%는 스로틀 기준일 뿐 트랙션의 증거가 아닙니다. 압력·그립·세팅을 추론하지 않습니다.")}</p>`;
}

function residualCopy() {
  const rows=sectorChecks().filter(r=>Number.isFinite(r.residual));
  return rows.length ? rows.map(r=>`S${r.sector} ${signed(r.residual,3)}s`).join(" / ") : tr("No supported timing boundary", "비교 가능한 타이밍 경계 없음");
}

function renderOverview() {
  const a=state.replayData.get(Number(state.selectedA))?.lap,b=state.replayData.get(Number(state.selectedB))?.lap;
  const target=$("result-overview");
  if (state.mode!=="replay"||!a||!b) { target.innerHTML=`<p>${tr("Choose two completed laps to investigate braking and acceleration differences.", "완료된 두 랩을 선택하면 제동·가속 차이를 조사할 수 있습니다.")}</p>`; return; }
  const delta=Number(a.lap_duration)-Number(b.lap_duration);
  const sectors=[1,2,3].map(i=>({sector:i,delta:Number(a[`duration_sector_${i}`])-Number(b[`duration_sector_${i}`]),valid:Number(a[`duration_sector_${i}`])>0&&Number(b[`duration_sector_${i}`])>0})).filter(r=>r.valid);
  const biggest=[...sectors].sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta))[0];
  const comparison = `${shortName(state.selectedA)} L${a.lap_number} / ${shortName(state.selectedB)} L${b.lap_number}`;
  const context = state.selectedMode === "replay" ? [comparison] : [state.session.year || new Date(state.session.date_start).getUTCFullYear(), sessionTitle(state.session), a.qualifying_segment, comparison];
  target.innerHTML=`<div><span class="panel-kicker">${context.filter(Boolean).map(esc).join(" · ")}</span><h2>${delta===0 ? tr("Equal reported lap times", "기록상 동일한 랩타임") : `${shortName(delta<0?state.selectedA:state.selectedB)} <strong>${Math.abs(delta).toFixed(3)}s</strong> ${tr("quicker in this pair", "이 랩 쌍에서 빠름")}`}</h2><p>${tr("Reported timing · A − B", "타이밍 기록 · A − B")} ${signed(delta)}s · ${tr("Selected laps, not a driver ranking", "선택 랩 비교이며 드라이버 순위가 아님")}</p></div><button id="focus-largest-sector" class="sector-result" type="button" ${biggest ? "" : "disabled"}><span>${tr("Largest reported sector difference", "기록상 가장 큰 섹터 차이")}</span><strong>${biggest ? `S${biggest.sector} ${signed(biggest.delta)}s` : "—"}</strong><small>${tr("Inspect interval ↗", "구간 조사 ↗")}</small></button>`;
  if(biggest) $("focus-largest-sector").addEventListener("click",()=>focusSector(biggest.sector));
}

function renderWorkspaceLabels() {
  const active=linkedTraceActive();
  document.body.classList.toggle("progress-mode",active);
  document.querySelectorAll(".linked-only").forEach(node=>node.classList.toggle("hidden",!active));
  $("selection-results").classList.toggle("hidden",!active);
  $("trace-quality-note").classList.toggle("hidden",!active);
  document.querySelector(".range-controls").classList.toggle("hidden",!active);
  $("axis-progress").disabled=state.mode!=="replay"||!state.distanceAnalysis;
  $("axis-time").disabled=state.mode!=="replay";
  $("axis-progress").setAttribute("aria-pressed",String(active)); $("axis-time").setAttribute("aria-pressed",String(!active));
  $("axis-progress").textContent=tr("Estimated progress", "추정 진행도"); $("axis-time").textContent=tr("Lap time", "랩 경과시간");
  $("apply-range").textContent=tr("Zoom", "확대"); $("reset-range").textContent=tr("Full lap", "전체 랩");
  $("range-from-label").textContent=tr("From %", "시작 %"); $("range-to-label").textContent=tr("To %", "끝 %");
  $("trace-help").textContent=active ? tr("Drag a trace to zoom; double-click or Escape to reset. Arrow keys move the shared cursor.", "어느 그래프든 드래그하면 네 그래프가 함께 확대됩니다. 더블클릭·Esc로 복귀, 방향키로 공통 커서 이동. A 기준 추정 진행도이며 미터 거리·레이싱라인이 아닙니다.") : tr("Time view: equal seconds are not equal track positions. Switch to estimated progress to compare braking and acceleration locations. LIVE retains a rolling time window.", "시간 보기: 같은 초가 같은 트랙 위치는 아닙니다. 제동·가속 지점 비교에는 추정 진행도를 선택하세요. LIVE는 이동 시간창을 유지합니다.");
  $("comparison-details-label").textContent=tr("Comparison conditions & limits", "비교 조건·한계");
  $("secondary-label").textContent=tr("Lap / window summary & live events", "랩·시간창 요약 / 실시간 이벤트");
  $("brake-title").textContent=tr("Brake ON / OFF", "브레이크 ON / OFF");
  $("tab-distance").textContent=tr("Alignment","정렬 점검");
  $("open-linked-traces").textContent=tr("Open linked traces ↗","연결된 그래프 보기 ↗");
  $("open-linked-traces").disabled=!state.distanceAnalysis||state.mode!=="replay";
  document.querySelector(".brake-panel .chart-unit").textContent=tr("A upper / B lower · binary", "위 A / 아래 B · 이진 신호");
  document.querySelector(".inputs-panel h2").textContent=active ? tr("Throttle", "스로틀") : tr("Throttle & braking events", "스로틀과 제동 이벤트");
  $("linked-delta-title").textContent=tr("Position-derived Δt · exploratory", "위치 유래 Δt · 탐색용");
  $("alignment-note").textContent=active ? tr("Shared estimated progress; original timestamps, no forced timing agreement.", "공통 추정 진행도이며 원래 시각을 유지합니다. 타이밍을 강제로 맞추지 않습니다.") : $("trace-help").textContent;
  const note=`${tr("Position-vs-timing residual", "위치–타이밍 잔차")}: ${residualCopy()}. ${tr("Not a ±error bound. Amber bands: sparse position intervals; local Δ is withheld there. No additional delta smoothing or forced sector agreement.", "±오차범위가 아닙니다. 황색 띠는 희소 위치 구간이며 해당 국소 Δ는 숨깁니다. Δ를 추가 평활하거나 섹터 기록에 강제로 맞추지 않습니다.")}`;
  $("trace-quality-note").innerHTML='Estimated progress; shaded intervals have sparse position samples. <a href="#methodology">Alignment details</a>.'; $("delta-limit").textContent=tr("Max A gain/loss and the curve are exploratory, not precise corner-loss measurements. ", "Max A gain/loss와 곡선은 탐색용이며 정밀한 코너 손실 측정값이 아닙니다. ")+note;
}

function renderWorkspace() {
  if (!workspaceReady) return false;
  const stamp=[state.distanceAnalysis,state.mode,state.selectedMode,state.traceAxis,state.progressWindow[0],state.progressWindow[1],state.source];
  const redraw = !workspaceStamp || stamp.some((v,i)=>v!==workspaceStamp[i]);
  if (redraw) {
    workspaceStamp=stamp;
    renderWorkspaceLabels(); renderOverview();
    $("range-from").value=(state.progressWindow[0]*100).toFixed(1); $("range-to").value=(state.progressWindow[1]*100).toFixed(1);
    if(linkedTraceActive()) renderSelection();
  }
  if (!linkedTraceActive()) return false;
  updateNames();
  const points=selectedTracePoints(), point=alignedPoint(clippedProgress(state.cursorProgress));
  if (redraw) {
  const deltas=points.map(p=>p.delta).filter(Number.isFinite), range=Math.max(.05,...deltas.map(v=>Math.abs(v)*1.12));
  $("speed-a").setAttribute("d",tracePath(points,"speedA",290,360)); $("speed-b").setAttribute("d",tracePath(points,"speedB",290,360));
  $("throttle-line-a").setAttribute("d",tracePath(points,"throttleA",210,100)); $("throttle-line-b").setAttribute("d",tracePath(points,"throttleB",210,100));
  // Separate binary lanes keep brake state separate from percent throttle.
  const brakePoints=points.map(p=>({...p,laneA:Number.isFinite(p.brakeA)?(p.brakeA>0?.95:.6):null,laneB:Number.isFinite(p.brakeB)?(p.brakeB>0?.4:.05):null}));
  $("brake-line-a").setAttribute("d",tracePath(brakePoints,"laneA",70,1,false,true)); $("brake-line-b").setAttribute("d",tracePath(brakePoints,"laneB",70,1,false,true));
  $("linked-delta-path").setAttribute("d",tracePath(points,"delta",150,range,true));
  $("linked-y-max").textContent=`+${range.toFixed(2)}`; $("linked-y-min").textContent=`−${range.toFixed(2)}`;
  document.querySelector(".linked-delta-panel .chart-unit").textContent=`A − B · ±${range.toFixed(2)}s ${tr("plot scale", "표시 범위")}`;
  const labels=Array.from({length:5},(_,i)=>`<span>${progressText(state.progressWindow[0]+(state.progressWindow[1]-state.progressWindow[0])*i/4)}</span>`).join("");
  document.querySelectorAll(".shared-x-labels").forEach(node=>node.innerHTML=labels);
  }
  for(const [name,height] of [["speed",290],["input",210],["brake",70],["linked-delta",150]]) {
    const chart=$(`${name}-chart`);
    paintSupport(chart,height);
    const cursor=$(`${name}-cursor`);cursor.setAttribute("x1",progressX(point.progress));cursor.setAttribute("x2",progressX(point.progress));
  }
  for(const side of ["A","B"]) {
    const driver=side==="A"?state.selectedA:state.selectedB, lap=state.distanceAnalysis[`lap${side}`];
    updateReadout(side.toLowerCase(),alignedCursorSample(side,point));
    if (redraw) {
    const stats=rollingStats(lap.telemetry.filter(p=>p.progress>=state.progressWindow[0]&&p.progress<=state.progressWindow[1]));
    $("min-speed-"+side.toLowerCase()).textContent=stats.min==null?"—":Math.round(stats.min);
    $("full-throttle-"+side.toLowerCase()).textContent=stats.full==null?"—":stats.full.toFixed(0);
    $("brake-events-"+side.toLowerCase()).textContent=stats.brakes??"—";
    }
  }
  $("speed-delta").textContent=Number.isFinite(point.speedA)&&Number.isFinite(point.speedB)?`${signed(point.speedA-point.speedB,1)}km/h`:"—km/h";
  $("data-age").textContent=progressText(point.progress);
  $("window-label").textContent=`${progressText(state.progressWindow[0])}–${progressText(state.progressWindow[1])}`;
  drawLinkedMap(point,redraw);renderLinkedTooltip(point);if(redraw)renderEvents();
  return true;
}

function renderTimeWorkspace() {
  $("track-selection")?.setAttribute("d","");
  document.querySelectorAll(".support-bands,.selection-band").forEach(node=>node.innerHTML="");
}

function addCaseEvidence() {
  if (!workspaceReady) return;
  const methods = document.createElement("section");
  methods.innerHTML = `<h3>${tr("Local support and two-point fits", "국소 표본 근거와 두 점 적합")}</h3><p>${tr("Local Δ is withheld across a position interval longer than min(2 seconds, 3 × that lap's median position interval), outside shared support, or at ambiguous projected plateaus. The amber bands show sparse intervals, not uncertainty bounds. Whole-lap quality gates still apply. No extra delta smoothing is applied. Selected-interval Δ change is withheld if a masked region lies inside it. Two-lap rows keep only a descriptive two-point slope; R² is suppressed and these rows are excluded from strategy inputs. Three or more laps do not establish tyre-model validity.", "위치 간격이 min(2초, 해당 랩의 위치 표본 중앙 간격×3)보다 크거나, 공통 범위 밖이거나, 투영이 중복 진행도인 지점이면 국소 Δ를 숨깁니다. 황색 띠는 희소 구간이지 불확실성 범위가 아닙니다. 전체 랩 품질 기준도 적용하며 Δ를 추가 평활하지 않습니다. 숨긴 구간이 포함되면 선택 구간의 Δ 변화도 보류합니다. 두 랩 행은 두 점 사이 기술적 기울기만 남기고 R²를 숨기며 전략 입력에서 제외합니다. 3개 이상도 타이어 모델 타당성을 보증하지 않습니다.")}</p>`;
  $("methods-content").append(methods);
  if (state.source!=="demo" || !state.distanceAnalysis) return;
  const target=$("case-content"), checks=sectorChecks();
  const biggest=[...checks].sort((a,b)=>Math.abs(b.sectorDelta)-Math.abs(a.sectorDelta))[0];
  const zones=state.distanceAnalysis.corners;
  const actions=document.createElement("div"); actions.className="case-actions";
  if (biggest) { const button=document.createElement("button");button.className="text-button";button.textContent=tr(`Inspect reported S${biggest.sector} interval ↗`,`기록상 S${biggest.sector} 구간 조사 ↗`);button.addEventListener("click",()=>focusSector(biggest.sector));actions.append(button); }
  if(zones.length) {
    const selector=document.createElement("select");selector.setAttribute("aria-label",tr("Inspect a speed zone", "속도 구간 조사"));selector.innerHTML=`<option value="">${tr("Inspect a speed zone…", "속도 구간 조사…")}</option>`+zones.map((z,i)=>`<option value="${i}">Z${z.number} · ${progressText(z.entry.progress)}–${progressText(z.exit.progress)}</option>`).join("");
    selector.addEventListener("change",()=>{ if(selector.value!=="") {const z=zones[Number(selector.value)];setProgressWindow(z.entry.progress,z.exit.progress);document.querySelector(".trace-stack").scrollIntoView({behavior:"smooth"});}});actions.append(selector);
  }
  target.prepend(actions);
  const evidence=document.createElement("div");evidence.className="evidence-block";
  const describe = side => {
    const lap=state.distanceAnalysis[`lap${side}`];
    return `${side}: ${tr("median / maximum position interval", "위치 중앙 / 최대 간격")} ${lap.quality.medianGap.toFixed(3)} / ${lap.quality.maxGap.toFixed(3)}s · ${tr("rejected", "제외")} ${lap.quality.rejected} · ${tr("backward projections", "역방향 투영")} ${lap.quality.projectionReversals||0}`;
  };
  evidence.innerHTML=`<h3>${tr("Alignment checks", "관측 근거 → 가능한 메커니즘 → 남는 불확실성")}</h3><p>${describe("A")}<br>${describe("B")}</p><p>${tr("Position-vs-timing residual", "위치–타이밍 잔차")}: ${residualCopy()}.</p><p>${tr("The data contain uneven position intervals. Each lap uses its own start time, and B is projected onto line segments of A's median-filtered path. Gaps are interpolated where permitted. These are confirmed processing steps; they can affect a local time difference. The respective contributions of source position error, reconstructed start timing, coordinate filtering and projection are not separately identified. Oscillation alone is not proof of a calculation error: real local gains and losses can also cancel.", "위치 표본 간격은 불균일합니다. 각 랩의 시작시각을 기준으로 B를 중앙값 처리한 A 경로의 선분에 투영하고 허용 범위의 공백을 보간합니다. 이 과정은 코드와 자료에서 확인되며 국소 시간차에 영향을 줄 수 있습니다. 원천 위치 오차·시작시각 재구성·좌표 처리·투영 각각의 기여는 분리 식별하지 못했습니다. 실제 국소 이득과 손실도 상쇄될 수 있으므로 요동 자체가 계산 오류의 증거는 아닙니다.")}</p>`;
  target.append(evidence);
  const pairs=[25,22].map(number=>{
    const a=state.demo.datasets.find(d=>Number(d.lap.driver_number)===Number(state.selectedA)&&d.lap.lap_number===number)?.lap;
    const b=state.demo.datasets.find(d=>Number(d.lap.driver_number)===Number(state.selectedB)&&d.lap.lap_number===number)?.lap;
    return a&&b ? {number,a,b,sectors:[1,2,3].map(i=>a[`duration_sector_${i}`]-b[`duration_sector_${i}`])} : null;
  }).filter(Boolean);
  const cross=document.createElement("div");cross.className="evidence-block";
  cross.innerHTML=`<h3>${tr("Does another Q3 lap support the same reading?", "다른 Q3 랩에서도 같은 해석이 유지되는가?")}</h3><div class="table-scroll"><table class="analysis-table"><thead><tr><th>${tr("Lap pair", "랩 쌍")}</th><th>S1 Δ</th><th>S2 Δ</th><th>S3 Δ</th><th>${tr("Finish Δ", "최종 Δ")}</th><th>${tr("Start tyre age A / B", "시작 타이어 사용 랩 A / B")}</th><th>${tr("Start separation", "출발시각 차이")}</th></tr></thead><tbody>${pairs.map(p=>`<tr><td><button class="text-button case-pair" data-pair="${p.number}" type="button">L${p.number} / L${p.number} ↗</button></td>${p.sectors.map(d=>`<td>${signed(d)}s</td>`).join("")}<td>${signed(p.a.lap_duration-p.b.lap_duration)}s</td><td>${p.a.tyre_age_start_lap} / ${p.b.tyre_age_start_lap}</td><td>${(Math.abs(Date.parse(p.a.date_start)-Date.parse(p.b.date_start))/1000).toFixed(3)}s</td></tr>`).join("")}</tbody></table></div><p>${tr("The direction reverses: NOR is quicker in L25, PIA in L22. The largest reported sector difference moves from S1 to S3. L22 also differs in tyre age and start-time separation. Therefore the L25 observation does not establish a repeatable NOR S1 advantage, and L22 is not a controlled validation. Keep the selected-lap finding, investigate the linked inputs, and do not generalise it to driver skill or setup.", "결과 방향이 바뀝니다. L25는 NOR, L22는 PIA가 빠르고, 가장 큰 섹터 차이도 S1에서 S3로 옮겨갑니다. L22는 타이어 사용 랩 수와 출발시각 차이도 다릅니다. 따라서 L25 관측만으로 NOR의 반복적인 S1 강점을 확정할 수 없으며 L22도 통제된 검증은 아닙니다. 선택 랩의 결과는 유지하되 연결된 입력을 조사하고 드라이버 실력·세팅으로 일반화하지 않습니다.")}</p>`;
  cross.querySelectorAll(".case-pair").forEach(button=>button.addEventListener("click",()=>{const number=Number(button.dataset.pair);state.chosenLaps.set(Number(state.selectedA),number);state.chosenLaps.set(Number(state.selectedB),number);applyDemoComparison();document.querySelector(".result-overview").scrollIntoView({behavior:"smooth"});}));
  target.append(cross);
}

setupWorkspace();
if (state.distanceAnalysis) { renderCase(); renderMethods(); addCaseEvidence(); }
