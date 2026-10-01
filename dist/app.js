"use strict";

const API_BASE = "https://api.openf1.org/v1";
const LIVE_WINDOW_SECONDS = 60;
const BUFFER_SECONDS = 100;
const REPLAY_YEAR = 2026;
const API_REQUEST_GAP_MS = 2100;
const LIVE_POLL_MS = 2000;
const LIVE_SESSION_WATCH_MS = 15000;
const REPLAY_CACHE_KEY = "f1-telemetry-replay-v2";
const REPLAY_CACHE_TTL_MS = 30 * 60 * 1000;
const LATEST_KNOWN_ROSTER = Object.freeze([
  { driver_number: 1, name_acronym: "NOR", full_name: "Lando NORRIS", team_name: "McLaren" },
  { driver_number: 3, name_acronym: "VER", full_name: "Max VERSTAPPEN", team_name: "Red Bull Racing" },
  { driver_number: 5, name_acronym: "BOR", full_name: "Gabriel BORTOLETO", team_name: "Audi" },
  { driver_number: 10, name_acronym: "GAS", full_name: "Pierre GASLY", team_name: "Alpine" },
  { driver_number: 11, name_acronym: "PER", full_name: "Sergio PEREZ", team_name: "Cadillac" },
  { driver_number: 12, name_acronym: "ANT", full_name: "Kimi ANTONELLI", team_name: "Mercedes" },
  { driver_number: 14, name_acronym: "ALO", full_name: "Fernando ALONSO", team_name: "Aston Martin" },
  { driver_number: 16, name_acronym: "LEC", full_name: "Charles LECLERC", team_name: "Ferrari" },
  { driver_number: 18, name_acronym: "STR", full_name: "Lance STROLL", team_name: "Aston Martin" },
  { driver_number: 22, name_acronym: "TSU", full_name: "Yuki TSUNODA", team_name: "Racing Bulls" },
  { driver_number: 23, name_acronym: "ALB", full_name: "Alexander ALBON", team_name: "Williams" },
  { driver_number: 27, name_acronym: "HUL", full_name: "Nico HULKENBERG", team_name: "Audi" },
  { driver_number: 30, name_acronym: "LAW", full_name: "Liam LAWSON", team_name: "Red Bull Racing" },
  { driver_number: 31, name_acronym: "OCO", full_name: "Esteban OCON", team_name: "Haas F1 Team" },
  { driver_number: 41, name_acronym: "LIN", full_name: "Arvid LINDBLAD", team_name: "Racing Bulls" },
  { driver_number: 43, name_acronym: "COL", full_name: "Franco COLAPINTO", team_name: "Alpine" },
  { driver_number: 44, name_acronym: "HAM", full_name: "Lewis HAMILTON", team_name: "Ferrari" },
  { driver_number: 55, name_acronym: "SAI", full_name: "Carlos SAINZ", team_name: "Williams" },
  { driver_number: 63, name_acronym: "RUS", full_name: "George RUSSELL", team_name: "Mercedes" },
  { driver_number: 77, name_acronym: "BOT", full_name: "Valtteri BOTTAS", team_name: "Cadillac" },
  { driver_number: 81, name_acronym: "PIA", full_name: "Oscar PIASTRI", team_name: "McLaren" },
  { driver_number: 87, name_acronym: "BEA", full_name: "Oliver BEARMAN", team_name: "Haas F1 Team" },
]);

const $ = (id) => document.getElementById(id);
// The interface is English-only; existing renderers use the first copy argument.
const tr = (en) => en;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// Missing values stay missing. Boolean conversion is only valid for brake.
function numberOrNull(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function brakeOrNull(value) { return typeof value === "boolean" ? Number(value) : numberOrNull(value); }
function roundedOrNull(value) { return Number.isFinite(value) ? Math.round(value) : null; }
function telemetryChannels(sample) {
  return { ...sample, speed:numberOrNull(sample.speed), throttle:numberOrNull(sample.throttle), brake:brakeOrNull(sample.brake), n_gear:numberOrNull(sample.n_gear), rpm:numberOrNull(sample.rpm), drs:numberOrNull(sample.drs) };
}
function tyreAgeForLap(lap, stint) {
  const explicit=numberOrNull(lap?.tyre_age_start_lap);
  if (explicit !== null) return explicit >= 0 ? explicit : null;
  const age=numberOrNull(stint?.tyre_age_at_start), start=numberOrNull(stint?.lap_start), lapNumber=numberOrNull(lap?.lap_number);
  if (age === null || start === null || lapNumber === null) return null;
  const result=age+lapNumber-start;
  return result >= 0 ? result : null;
}

const state = {
  mode: "replay",
  selectedMode: "demo",
  replayLoading: false,
  replayError: null,
  token: "",
  session: null,
  sessionCatalog: [],
  drivers: [...LATEST_KNOWN_ROSTER],
  laps: [],
  replayData: new Map(),
  selectedA: 1,
  selectedB: 3,
  telemetry: new Map(),
  locations: new Map(),
  events: [],
  liveTimer: null,
  liveSessionTimer: null,
  replayAnimation: null,
  replayDuration: 84,
  replayCursor: 0,
  lastTelemetryDate: null,
  lastLocationDate: null,
  liveDriverSessionKey: null,
  hoverTime: null,
  hoverChart: null,
  hoverFraction: null,
  hoverTopPx: null,
  traceAxis: "progress",
  progressWindow: [0, 1],
  cursorProgress: 0.5,
  tracePointer: null,
  traceDrag: null,
  activeAnalysisTab: "distance",
  distanceAnalysis: null,
  sessionContext: null,
  stints: [],
  stintsSessionKey: null,
  stintsStatus: "idle",
  paceRows: [],
  contextLoading: false,
  fetching: false,
  source: "waiting",
  lastRender: 0,
  generation: 0,
  chosenLaps: new Map(),
  demo: null,
  replayYear: REPLAY_YEAR,
};

function kstClock() {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date()) + " KST";
}

function setStatus(kind, label) {
  $("connection-dot").className = `status-dot ${kind}`;
  $("connection-label").textContent = label;
}

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

function driverInfo(number) {
  return state.drivers.find((driver) => Number(driver.driver_number) === Number(number)) || {
    driver_number: number,
    name_acronym: `#${number}`,
    full_name: "Driver data waiting",
    team_name: "",
  };
}

function shortName(number) {
  return driverInfo(number).name_acronym || `#${number}`;
}

function apiUrl(endpoint, params = {}) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.append(key, String(value));
  });
  return url.toString();
}

let apiRequestGate = Promise.resolve();
let lastApiRequestAt = 0;
const activeApiRequests = new Set();
async function waitForApiSlot() {
  const previousRequest = apiRequestGate;
  let releaseSlot;
  apiRequestGate = new Promise((resolve) => { releaseSlot = resolve; });
  await previousRequest;
  const waitMs = Math.max(0, API_REQUEST_GAP_MS - (Date.now() - lastApiRequestAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastApiRequestAt = Date.now();
  return releaseSlot;
}

async function apiFetch(endpoint, params = {}, token = "", retryCount = 0) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const requestGeneration = state.generation;
  const releaseSlot = await waitForApiSlot();
  if (requestGeneration !== state.generation) { releaseSlot(); throw Object.assign(new Error("Request cancelled"), { code: "cancelled" }); }
  const controller = new AbortController();
  activeApiRequests.add(controller);
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  let response, data;
  try {
    response = await fetch(apiUrl(endpoint, params), { headers, cache: "no-store", signal: controller.signal });
    if (response.ok) data = await response.json();
  } catch (error) {
    throw Object.assign(new Error(timedOut ? "OpenF1 request timed out" : "OpenF1 response unavailable to this browser"), { code: timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "network" });
  } finally {
    clearTimeout(timeout);
    activeApiRequests.delete(controller);
    releaseSlot();
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw Object.assign(new Error(tr("OpenF1 access restricted: LIVE requires paid access; historical requests can also be restricted during a live session. The frozen DEMO remains available.", "OpenF1 접근 제한: LIVE에는 유료 인증이 필요하며 경기 중에는 과거 데이터 요청도 제한될 수 있습니다. 동결 DEMO는 계속 이용할 수 있습니다.")), { code: "access", status: response.status });
    if (response.status === 429 && retryCount < 2) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? Math.max(2500 * (retryCount + 1), retryAfter * 1000) : 5000));
      return apiFetch(endpoint, params, token, retryCount + 1);
    }
    if (response.status === 429) throw Object.assign(new Error(tr("OpenF1 request limit reached. Please retry later or use DEMO.", "OpenF1 요청 한도에 도달했습니다. 잠시 후 다시 시도하거나 DEMO를 이용해주세요.")), { code: "rate_limit" });
    throw new Error(`OpenF1 HTTP ${response.status}`);
  }
  return data;
}

async function optionalApiFetch(endpoint, params = {}, token = "") {
  try {
    return await apiFetch(endpoint, params, token);
  } catch (error) {
    if (/요청 한도|접근 제한|access restricted|request limit/i.test(String(error?.message || ""))) throw error;
    return [];
  }
}

function showDataWaiting(message = tr("Load real telemetry to display traces.", "실제 데이터를 불러오면 그래프가 표시됩니다."), statusLabel = "REPLAY · WAITING") {
  state.events = [];
  if (state.drivers.length < 2) state.drivers = [...LATEST_KNOWN_ROSTER];
  pickDefaultDrivers(state.drivers);
  state.telemetry = new Map();
  state.locations = new Map();
  state.replayDuration = 0;
  state.source = "waiting";
  resetPerformanceAnalysis();
  updateDriverOptions();
  $("session-name").textContent = state.session ? sessionTitle(state.session) : "F1 session";
  $("source-label").textContent = "2026 ROSTER · DATA WAITING";
  $("source-label").style.borderColor = "rgba(255,186,73,.42)";
  $("source-label").style.color = "var(--amber)";
  setStatus("preview", statusLabel);
  addEvent("SYSTEM", message, "system");
  render();
}

function saveReplayCache() {
  try {
    sessionStorage.setItem(REPLAY_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      session: state.session,
      sessionCatalog: state.sessionCatalog,
      drivers: state.drivers,
      laps: state.laps,
      stints: state.stints,
      stintsSessionKey: state.stintsSessionKey,
      stintsStatus: state.stintsStatus,
      selectedA: state.selectedA,
      selectedB: state.selectedB,
      telemetry: [...state.telemetry.entries()],
      locations: [...state.locations.entries()],
      replayDuration: state.replayDuration,
    }));
  } catch (_) {
    // Historical telemetry caching is optional; live credentials are never stored.
  }
}

function restoreReplayCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(REPLAY_CACHE_KEY) || "null");
    if (!cached || Date.now() - cached.savedAt > REPLAY_CACHE_TTL_MS) return false;
    state.session = cached.session;
    state.sessionCatalog = Array.isArray(cached.sessionCatalog) ? cached.sessionCatalog : [];
    state.drivers = cached.drivers;
    state.laps = Array.isArray(cached.laps) ? cached.laps : [];
    state.stints = Array.isArray(cached.stints) ? cached.stints : [];
    state.stintsSessionKey = cached.stintsSessionKey ?? null;
    state.stintsStatus = cached.stintsStatus || "idle";
    state.selectedA = Number(cached.selectedA);
    state.selectedB = Number(cached.selectedB);
    state.telemetry = new Map(cached.telemetry.map(([driver, samples]) => [Number(driver), samples]));
    state.locations = new Map(cached.locations.map(([driver, samples]) => [Number(driver), samples]));
    state.replayData = new Map();
    [Number(cached.selectedA), Number(cached.selectedB)].forEach((driver) => {
      state.replayData.set(driver, {
        lap: fastestLap(state.laps, driver),
        telemetry: state.telemetry.get(driver) || [],
        locations: state.locations.get(driver) || [],
      });
    });
    state.replayDuration = Number(cached.replayDuration);
    state.source = "openf1";
    state.events = [];
    updateSessionOptions();
    updateDriverOptions();
    $("session-name").textContent = sessionTitle(state.session);
    $("source-label").textContent = "OPENF1 · FASTEST LAPS";
    $("source-label").style.borderColor = "rgba(57,229,140,.42)";
    $("source-label").style.color = "var(--green)";
    setStatus("live", "REPLAY · OpenF1");
    addEvent("SYSTEM", tr("Cached historical replay", "임시 보관된 과거 리플레이"), "system");
    resetReplayClock();
    buildDistancePerformanceAnalysis();
    return true;
  } catch (_) {
    sessionStorage.removeItem(REPLAY_CACHE_KEY);
    return false;
  }
}

function updateDriverOptions() {
  const options = [...state.drivers]
    .sort((a, b) => Number(a.driver_number) - Number(b.driver_number))
    .map((driver) => `<option value="${driver.driver_number}">${driver.name_acronym || driver.driver_number} · ${driver.full_name || ""}${driver.team_name ? ` — ${driver.team_name}` : ""}</option>`)
    .join("");
  $("driver-a").innerHTML = options;
  $("driver-b").innerHTML = options;
  $("driver-a").value = String(state.selectedA);
  $("driver-b").value = String(state.selectedB);
  $("driver-a").disabled = $("driver-b").disabled = state.replayLoading || state.drivers.length < 2;
  updateNames();
}

function updateNames() {
  const a = shortName(state.selectedA);
  const b = shortName(state.selectedB);
  $("legend-a").textContent = a;
  $("legend-b").textContent = b;
  $("readout-name-a").textContent = a;
  $("readout-name-b").textContent = b;
}

function stopStreams() {
  state.generation += 1;
  activeApiRequests.forEach((controller) => controller.abort());
  if (state.liveTimer) clearTimeout(state.liveTimer);
  state.liveTimer = null;
  if (state.liveSessionTimer) clearTimeout(state.liveSessionTimer);
  state.liveSessionTimer = null;
  if (state.replayAnimation) cancelAnimationFrame(state.replayAnimation);
  state.replayAnimation = null;
  state.fetching = false;
  clearChartHover();
}

function setMode(mode) {
  if (!["replay", "live"].includes(mode)) return;
  if (state.selectedMode === mode) return;
  stopStreams();
  state.mode = mode;
  state.selectedMode = mode;
  state.replayError = null;
  state.replayLoading = false;
  state.token = "";
  state.source = "waiting";
  state.session = null;
  state.sessionCatalog = [];
  state.drivers = [];
  state.laps = [];
  state.replayData = new Map();
  state.telemetry = new Map();
  state.locations = new Map();
  state.replayDuration = 0;
  state.events = [];
  state.chosenLaps.clear();
  resetPerformanceAnalysis();
  updateDriverOptions();
  updateLapSelectors();
  clearChartHover();
  $("alignment-note").textContent = mode === "live"
    ? tr("LIVE: last 60 seconds, not a corner-aligned comparison.", "LIVE는 최근 60초이며 코너 정렬 비교가 아닙니다.")
    : tr("REPLAY: each lap's elapsed time. Use DISTANCE for approximate alignment.", "REPLAY는 각 랩의 경과시간 기준입니다. 근사 정렬은 DISTANCE에서 확인합니다.");
  if (mode === "replay") {
    $("delta-label").textContent = "Speed difference · A − B";
    loadReplay({ skipCache: true, force: true });
  } else {
    state.source = "pending";
    state.session = null;
    state.telemetry = new Map();
    state.locations = new Map();
    state.events = [];
    state.lastTelemetryDate = null;
    state.lastLocationDate = null;
    state.liveDriverSessionKey = null;
    resetPerformanceAnalysis();
    $("delta-label").textContent = "INSTANT SPEED Δ · A − B";
    $("session-name").textContent = tr("Waiting for a live connection", "실시간 연결 대기");
    setStatus("preview", "LIVE · DISCONNECTED");
    $("source-label").textContent = "TOKEN REQUIRED";
    $("source-label").style.borderColor = "rgba(255,186,73,.42)";
    $("source-label").style.color = "var(--amber)";
    toast(tr("LIVE requires a paid OpenF1 access token. DEMO is free.", "LIVE에는 유료 OpenF1 토큰이 필요합니다. DEMO는 무료입니다."));
  }
  if (typeof updateLabDetails === "function") updateLabDetails();
  render();
}

function sessionTitle(session) {
  if (!session) return tr("No session", "세션 정보 없음");
  const location = session.location || session.country_name || "F1";
  return `${location} · ${session.session_name || session.session_type || "Session"}`;
}

function isReplaySession(session) {
  const name = String(session.session_name || session.session_type || "").toLowerCase();
  return !name.includes("testing") && /(practice|qualifying|race|sprint)/.test(name);
}

function sessionStartMs(session) {
  const value = Date.parse(session.date_start || "");
  return Number.isFinite(value) ? value : 0;
}

function sessionEndMs(session) {
  const value = Date.parse(session.date_end || "");
  return Number.isFinite(value) ? value : 0;
}

function meetingPlace(session) {
  return session.location || session.country_name || session.circuit_short_name || "F1";
}

function meetingLabel(session) {
  const place = meetingPlace(session);
  const date = sessionStartMs(session)
    ? new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(sessionStartMs(session)))
    : String(REPLAY_YEAR);
  return `${place} · ${date}`;
}

function updateSessionOptions() {
  const select = $("replay-session");
  if (!select) return;
  select.replaceChildren();
  if (!state.sessionCatalog.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = `${state.replayYear} · ${state.replayLoading ? tr("loading sessions…", "세션 불러오는 중…") : tr("session list unavailable · retry", "세션 목록 없음 · 다시 시도")}`;
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = state.replayLoading;

  const meetings = new Map();
  state.sessionCatalog.forEach((session) => {
    const key = String(session.meeting_key ?? meetingLabel(session));
    if (!meetings.has(key)) meetings.set(key, []);
    meetings.get(key).push(session);
  });
  [...meetings.values()]
    .sort((a, b) => Math.max(...b.map(sessionStartMs)) - Math.max(...a.map(sessionStartMs)))
    .forEach((sessions) => {
      const group = document.createElement("optgroup");
      group.label = meetingLabel(sessions[0]);
      sessions.sort((a, b) => sessionStartMs(a) - sessionStartMs(b)).forEach((session) => {
        const option = document.createElement("option");
        option.value = String(session.session_key);
        option.textContent = `${meetingPlace(session)} · ${session.session_name || session.session_type || "Session"}`;
        group.append(option);
      });
      select.append(group);
    });
  if (state.session?.session_key != null) select.value = String(state.session.session_key);
}

async function loadSessionCatalog({ force = false } = {}) {
  if (state.sessionCatalog.length && !force) {
    updateSessionOptions();
    return state.sessionCatalog;
  }
  const generation = state.generation, year = state.replayYear;
  const sessions = await apiFetch("sessions", { year });
  if (generation !== state.generation || state.selectedMode !== "replay" || state.replayYear !== year) throw Object.assign(new Error("Request cancelled"), { code: "cancelled" });
  const now = Date.now();
  state.sessionCatalog = sessions
    .filter((session) => !session.is_cancelled && isReplaySession(session) && (sessionEndMs(session) || sessionStartMs(session)) <= now)
    .sort((a, b) => sessionStartMs(b) - sessionStartMs(a));
  if (!state.sessionCatalog.length) throw new Error(tr(`No completed sessions found for ${state.replayYear}.`, `${state.replayYear}년 완료 세션을 찾지 못했습니다.`));
  updateSessionOptions();
  return state.sessionCatalog;
}

function pickDefaultDrivers(drivers) {
  const sorted = [...drivers].sort((a, b) => Number(a.driver_number) - Number(b.driver_number));
  const currentNumbers = new Set(sorted.map((driver) => Number(driver.driver_number)));
  if (!currentNumbers.has(Number(state.selectedA))) state.selectedA = Number(sorted[0]?.driver_number ?? 1);
  if (!currentNumbers.has(Number(state.selectedB)) || Number(state.selectedB) === Number(state.selectedA)) {
    state.selectedB = Number(sorted.find((driver) => Number(driver.driver_number) !== Number(state.selectedA))?.driver_number ?? state.selectedA);
  }
}

function fastestLap(laps, driverNumber) {
  return laps
    .filter((lap) => Number(lap.driver_number) === Number(driverNumber) && Number(lap.lap_duration) > 0 && lap.date_start && !lap.is_pit_out_lap)
    .sort((a, b) => Number(a.lap_duration) - Number(b.lap_duration))[0] || null;
}

async function fetchLapDataset(driverNumber, lap, token = "", sessionKey = state.session?.session_key) {
  if (!lap) return { telemetry: [], locations: [] };
  const generation = state.generation;
  const startMs = Date.parse(lap.date_start);
  const endMs = startMs + Number(lap.lap_duration) * 1000 + 500;
  const params = {
    session_key: sessionKey,
    driver_number: driverNumber,
    "date>": new Date(startMs - 1).toISOString(),
    "date<": new Date(endMs + 1).toISOString(),
  };
  const carData = await apiFetch("car_data", params, token);
  if (generation !== state.generation) throw Object.assign(new Error("Request cancelled"), { code: "cancelled" });
  const locationData = await apiFetch("location", params, token);
  return {
    telemetry: carData.map((sample) => ({
      ...telemetryChannels(sample),
      t: Math.max(0, (Date.parse(sample.date) - startMs) / 1000),
    })).sort((a, b) => a.t - b.t),
    locations: locationData.map((sample) => ({
      ...sample,
      t: Math.max(0, (Date.parse(sample.date) - startMs) / 1000),
      x: numberOrNull(sample.x),
      y: numberOrNull(sample.y),
    })).sort((a, b) => a.t - b.t),
  };
}

async function loadReplay({ force = false, sessionKey = null, driverA = state.selectedA, driverB = state.selectedB } = {}) {
  if (state.selectedMode !== "replay") return;
  // Selection and loaded data are separate. A failed request never changes tabs
  // or relabels a previous successful session as the requested session.
  stopStreams();
  const generation = state.generation;
  const current = () => state.selectedMode === "replay" && state.generation === generation;
  state.replayLoading = true;
  state.replayError = null;
  updateSessionOptions();
  updateLabDetails();
  setStatus("preview", "REPLAY · LOADING OPENF1");
  try {
    await loadSessionCatalog({ force });
    if (!current()) return;
    const requestedKey = Number(sessionKey || $("replay-session").value || state.session?.session_key);
    const nextSession = state.sessionCatalog.find(session => Number(session.session_key) === requestedKey) || state.sessionCatalog[0];
    if (!nextSession) throw new Error(tr("No completed session found.", "완료 세션을 찾지 못했습니다."));
    const sameSession = state.source === "openf1" && Number(state.session?.session_key) === Number(nextSession.session_key);
    let drivers = sameSession && !force ? state.drivers : await apiFetch("drivers", { session_key: nextSession.session_key });
    if (!current()) return;
    const laps = sameSession && !force ? state.laps : await apiFetch("laps", { session_key: nextSession.session_key });
    if (!current()) return;
    let stints = sameSession && !force && Number(state.stintsSessionKey) === Number(nextSession.session_key) ? state.stints : null;
    let stintsStatus = "loaded";
    if (!stints) {
      try { stints = await apiFetch("stints", { session_key: nextSession.session_key }); }
      catch (_) { stints = []; stintsStatus = "error"; }
    }
    if (!current()) return;
    const eligible = drivers.filter(driver => fastestLap(laps, driver.driver_number));
    if (eligible.length < 2) throw new Error(tr("Fewer than two drivers with completed laps.", "완주 랩이 있는 드라이버가 두 명 미만입니다."));
    const selectedA = eligible.some(d => Number(d.driver_number) === driverA) ? driverA : Number(eligible[0].driver_number);
    const selectedB = driverB !== selectedA && eligible.some(d => Number(d.driver_number) === driverB)
      ? driverB : Number(eligible.find(d => Number(d.driver_number) !== selectedA).driver_number);
    const chosenLaps = sameSession ? new Map(state.chosenLaps) : new Map();
    const selectedLap = driver => laps.find(lap => Number(lap.driver_number) === driver && Number(lap.lap_number) === chosenLaps.get(driver)) || fastestLap(laps, driver);
    const lapA = selectedLap(selectedA), lapB = selectedLap(selectedB);
    const replayData = sameSession && !force ? new Map(state.replayData) : new Map();
    for (const [driver, lap] of [[selectedA, lapA], [selectedB, lapB]]) {
      const cached = replayData.get(driver);
      if (!cached || Number(cached.lap?.lap_number) !== Number(lap.lap_number)) {
        let data;
        try { data = await fetchLapDataset(driver, lap, "", nextSession.session_key); }
        catch(error) {
          if(error.code==="cancelled" || !current())throw error;
          data={telemetry:[],locations:[],unavailable:error.message};
        }
        if (!current()) return;
        replayData.set(driver, { lap, ...data });
      }
    }
    const dataA = replayData.get(selectedA), dataB = replayData.get(selectedB);
    const timingOnly=!dataA.telemetry.length || !dataB.telemetry.length;
    if (!sameSession) resetPerformanceAnalysis();
    Object.assign(state, { session: nextSession, drivers, laps, stints, stintsStatus, stintsSessionKey: Number(nextSession.session_key), selectedA, selectedB, chosenLaps, replayData, source: "openf1", events: [],
      telemetry: new Map([[selectedA,dataA.telemetry],[selectedB,dataB.telemetry]]),
      locations: new Map([[selectedA,dataA.locations],[selectedB,dataB.locations]]),
      replayDuration: Math.max(Number(lapA.lap_duration),Number(lapB.lap_duration)) });
    updateDriverOptions();
    updateLapSelectors();
    buildDistancePerformanceAnalysis();
    if (state.sessionContext) buildPaceRows();
    $("session-name").textContent = sessionTitle(nextSession);
    $("replay-session").value = String(nextSession.session_key);
    $("source-label").textContent = timingOnly ? "OPENF1 · TIMING LOADED · TRACE UNAVAILABLE" : "OPENF1 · SELECTED LAPS";
    $("source-label").style.borderColor = "rgba(57,229,140,.42)";
    $("source-label").style.color = "var(--green)";
    saveReplayCache();
    setStatus("live", timingOnly ? "REPLAY · Timing available" : "REPLAY · OpenF1");
    resetReplayClock();
  } catch (error) {
    if (!current()) return;
    state.replayError = { code: error.code || "other", message: error.message, status: error.status || null };
    setStatus("error", "REPLAY · LOAD FAILED");
    if (state.source !== "openf1") {
      $("source-label").textContent = tr("NO REPLAY DATA LOADED", "리플레이 데이터 없음");
      $("source-label").style.color = "var(--amber)";
    } else resetReplayClock();
  } finally {
    if (current()) {
      state.replayLoading = false;
      updateDriverOptions();
      updateLapSelectors();
      updateSessionOptions();
      updateLabDetails();
      render();
      if(!state.replayError && state.source==="openf1")loadSessionContext();
    }
  }
}

function resetReplayClock() {
  if (state.replayAnimation) cancelAnimationFrame(state.replayAnimation);
  resetPlaybackClock();
  const tick = (now) => {
    if (state.mode !== "replay") return;
    advanceReplayClock(now);
    if (now - state.lastRender > 33) {
      state.lastRender = now;
      render();
    }
    state.replayAnimation = requestAnimationFrame(tick);
  };
  state.replayAnimation = requestAnimationFrame(tick);
}

function normalizeLiveTelemetry(sample) {
  return {
    ...telemetryChannels(sample),
    t: Date.parse(sample.date) / 1000,
  };
}

function normalizeLocation(sample) {
  return { ...sample, t: Date.parse(sample.date) / 1000, x: numberOrNull(sample.x), y: numberOrNull(sample.y) };
}

function appendLiveSamples(samples) {
  let newest = state.lastTelemetryDate ? Date.parse(state.lastTelemetryDate) / 1000 : 0;
  samples.forEach((raw) => {
    const driver = Number(raw.driver_number);
    if (!state.telemetry.has(driver)) state.telemetry.set(driver, []);
    const sample = normalizeLiveTelemetry(raw);
    const list = state.telemetry.get(driver);
    const previous = list[list.length - 1];
    if (!previous || previous.date !== sample.date) {
      list.push(sample);
      if (driver === Number(state.selectedA) || driver === Number(state.selectedB)) detectEvents(driver, previous, sample);
    }
    newest = Math.max(newest, sample.t);
  });
  const cutoff = newest - BUFFER_SECONDS;
  state.telemetry.forEach((list, driver) => state.telemetry.set(driver, list.filter((sample) => sample.t >= cutoff)));
  if (newest) state.lastTelemetryDate = new Date(newest * 1000 + 1).toISOString();
}

function appendLiveLocations(samples) {
  let newest = state.lastLocationDate ? Date.parse(state.lastLocationDate) / 1000 : 0;
  samples.forEach((raw) => {
    const driver = Number(raw.driver_number);
    if (!state.locations.has(driver)) state.locations.set(driver, []);
    const sample = normalizeLocation(raw);
    const list = state.locations.get(driver);
    if (!list.length || list[list.length - 1].date !== sample.date) list.push(sample);
    newest = Math.max(newest, sample.t);
  });
  const cutoff = newest - BUFFER_SECONDS;
  state.locations.forEach((list, driver) => state.locations.set(driver, list.filter((sample) => sample.t >= cutoff)));
  if (newest) state.lastLocationDate = new Date(newest * 1000 + 1).toISOString();
}

function detectEvents(driver, previous, sample) {
  if (!previous) return;
  if (previous.brake === 0 && sample.brake > 0) addEvent(shortName(driver), `Brake onset · ${roundedOrNull(sample.speed) ?? "—"}km/h`, driver === Number(state.selectedA) ? "a" : "b", sample.date);
  if (Number.isFinite(previous.throttle) && Number.isFinite(sample.throttle) && previous.throttle < 95 && sample.throttle >= 95) addEvent(shortName(driver), `Full throttle · gear ${sample.n_gear ?? "—"}`, driver === Number(state.selectedA) ? "a" : "b", sample.date);
}

async function refreshLiveSession(generation, { announce = false } = {}) {
  if (state.mode !== "live" || !state.token || state.generation !== generation) return false;
  const sessions = await apiFetch("sessions", { session_key: "latest" }, state.token);
  if (state.mode !== "live" || state.generation !== generation) return false;
  if (!sessions.length) return false;

  const nextSession = sessions[0];
  const changed = Number(state.session?.session_key) !== Number(nextSession.session_key);
  state.session = nextSession;

  if (changed) {
    state.telemetry = new Map();
    state.locations = new Map();
    state.events = [];
    const bootstrap = new Date(Date.now() - 45_000).toISOString();
    state.lastTelemetryDate = bootstrap;
    state.lastLocationDate = bootstrap;
  }

  if (Number(state.liveDriverSessionKey) !== Number(state.session.session_key)) {
    try {
      const drivers = await apiFetch("drivers", { session_key: state.session.session_key }, state.token);
      if (state.mode !== "live" || state.generation !== generation) return false;
      if (drivers.length >= 2) {
        state.drivers = drivers;
        state.liveDriverSessionKey = state.session.session_key;
      }
    } catch (error) {
      if (/접근 제한|access restricted/i.test(error.message)) throw error;
      if (announce) toast(error.message);
    }
  }

  if (state.drivers.length < 2) state.drivers = [...LATEST_KNOWN_ROSTER];
  pickDefaultDrivers(state.drivers);
  updateDriverOptions();
  state.source = "openf1";
  $("session-name").textContent = sessionTitle(state.session);
  $("source-label").textContent = "OPENF1 · AUTHENTICATED";
  $("source-label").style.borderColor = "rgba(57,229,140,.42)";
  $("source-label").style.color = "var(--green)";
  const hasLiveSamples = [...state.telemetry.values()].some((samples) => samples.length);
  if (changed || !hasLiveSamples) setStatus("preview", "LIVE · WATCHING SESSION");
  if (changed) addEvent("SYSTEM", `${sessionTitle(state.session)} · ${tr("detected; waiting for data", "감지됨; 데이터 대기")}`, "system");
  render();
  return true;
}

function scheduleLiveSessionWatch(generation) {
  if (state.liveSessionTimer) clearTimeout(state.liveSessionTimer);
  state.liveSessionTimer = setTimeout(async () => {
    if (state.mode !== "live" || !state.token || state.generation !== generation) return;
    try {
      await refreshLiveSession(generation);
    } catch (error) {
      if (/접근 제한|access restricted/i.test(error.message)) {
        state.token = "";
        stopStreams();
        $("connect-live").disabled = false;
        setStatus("error", "LIVE · AUTH REQUIRED");
        toast(error.message);
        return;
      }
    }
    if (state.mode === "live" && state.token && state.generation === generation) scheduleLiveSessionWatch(generation);
  }, LIVE_SESSION_WATCH_MS);
}

async function connectLive() {
  const token = $("access-token").value.trim();
  if (!token) {
    toast(tr("An access token from a paid OpenF1 account is required.", "OpenF1 유료 계정에서 발급한 액세스 토큰이 필요합니다."));
    $("access-token").focus();
    return;
  }
  stopStreams();
  const generation = state.generation;
  state.token = token;
  state.session = null;
  state.telemetry = new Map();
  state.locations = new Map();
  state.events = [];
  state.lastTelemetryDate = null;
  state.lastLocationDate = null;
  state.liveDriverSessionKey = null;
  const button = $("connect-live");
  button.disabled = true;
  setStatus("preview", "LIVE · AUTHENTICATING");
  try {
    const sessionFound = await refreshLiveSession(generation, { announce: true });
    if (state.mode !== "live" || state.generation !== generation) return;
    if (!sessionFound) throw new Error(tr("No current or recent session found.", "현재 또는 최근 세션을 찾지 못했습니다."));
    $("alignment-note").textContent = tr("LIVE: last 60 seconds, not corner-aligned.", "LIVE는 최근 60초이며 코너 정렬이 아닙니다.");
    button.disabled = false;
    button.textContent = tr("RECONNECT", "다시 연결");
    scheduleLiveSessionWatch(generation);
    await pollLive(generation);
  } catch (error) {
    if (state.mode !== "live" || state.generation !== generation) return;
    button.disabled = false;
    setStatus("error", "LIVE · CONNECTION FAILED");
    toast(error.message);
  }
}

async function pollLive(generation = state.generation) {
  if (state.mode !== "live" || !state.token || state.generation !== generation) return;
  if (!state.session || state.fetching) {
    state.liveTimer = setTimeout(() => pollLive(generation), LIVE_POLL_MS);
    return;
  }
  state.fetching = true;
  let nextDelay = LIVE_POLL_MS;
  try {
    const polledSessionKey = state.session.session_key;
    const carData = await apiFetch("car_data", { session_key: polledSessionKey, "date>": state.lastTelemetryDate }, state.token);
    if (state.mode !== "live" || state.generation !== generation) return;
    if (Number(state.session?.session_key) !== Number(polledSessionKey)) {
      nextDelay = 300;
    } else {
      const locationData = await apiFetch("location", { session_key: polledSessionKey, "date>": state.lastLocationDate }, state.token);
      if (state.mode !== "live" || state.generation !== generation) return;
      if (Number(state.session?.session_key) !== Number(polledSessionKey)) {
        nextDelay = 300;
      } else {
        appendLiveSamples(carData);
        appendLiveLocations(locationData);
        render();
        const newest = latestSample(state.telemetry.get(Number(state.selectedA)) || []);
        if (newest) {
          const delay = Math.max(0, Date.now() / 1000 - newest.t);
          setStatus(delay < 15 ? "live" : "preview", delay < 15 ? "LIVE · RECEIVING" : "LIVE · WAITING");
        } else {
          setStatus("preview", "LIVE · WAITING FOR DATA");
        }
      }
    }
  } catch (error) {
    if (state.mode !== "live" || state.generation !== generation) return;
    setStatus("error", "LIVE · RECEIVE ERROR");
    toast(error.message);
    if (/접근 제한|access restricted|401|403/i.test(error.message)) {
      $("connect-live").disabled = false;
      state.token = "";
      if (state.liveSessionTimer) clearTimeout(state.liveSessionTimer);
      state.liveSessionTimer = null;
      return;
    }
    nextDelay = 3500;
  } finally {
    state.fetching = false;
  }
  if (state.mode === "live" && state.token && state.generation === generation) {
    state.liveTimer = setTimeout(() => pollLive(generation), nextDelay);
  }
}

function addEvent(driver, message, type = "system", isoDate = null) {
  state.events.unshift({
    driver,
    message,
    type,
    time: isoDate ? new Date(isoDate) : new Date(),
  });
  state.events = state.events.slice(0, 30);
  renderEvents();
}

function renderEvents() {
  const list = $("event-list");
  if (!state.events.length) {
    list.innerHTML = `<li class="event-empty">${tr("Live brake and full-throttle transitions appear here. No fabricated replay events.", "라이브 브레이크·풀스로틀 전환을 표시합니다. 리플레이 이벤트를 만들지 않습니다.")}</li>`;
    return;
  }
  list.innerHTML = state.events.map((event) => {
    const time = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(event.time);
    const cls = event.type === "a" ? "driver-a-event" : event.type === "b" ? "driver-b-event" : "";
    return `<li><time>${time}</time><b class="${cls}">${event.driver}</b><span>${event.message}</span></li>`;
  }).join("");
}

function latestSample(samples, cursor = null) {
  if (!samples?.length) return null;
  if (cursor === null) return samples[samples.length - 1];
  let low = 0;
  let high = samples.length - 1;
  let answer = samples[0];
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t <= cursor) {
      answer = samples[middle];
      low = middle + 1;
    } else high = middle - 1;
  }
  return answer;
}

function nearestSample(samples, cursor) {
  if (!samples?.length || !Number.isFinite(cursor)) return null;
  let low = 0;
  let high = samples.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t < cursor) low = middle + 1;
    else high = middle - 1;
  }
  if (low <= 0) return samples[0];
  if (low >= samples.length) return samples[samples.length - 1];
  return Math.abs(samples[low].t - cursor) < Math.abs(samples[low - 1].t - cursor) ? samples[low] : samples[low - 1];
}

function clearChartHover() {
  state.hoverTime = null;
  state.hoverChart = null;
  state.hoverFraction = null;
  state.hoverTopPx = null;
  $("speed-tooltip")?.classList.add("hidden");
  $("input-tooltip")?.classList.add("hidden");
}

function viewDomain() {
  let domain;
  if (state.mode === "replay") {
    domain = { start: 0, end: Math.max(1, state.replayDuration), cursor: state.replayCursor };
  } else {
    const all = [...(state.telemetry.get(Number(state.selectedA)) || []), ...(state.telemetry.get(Number(state.selectedB)) || [])];
    const end = all.length ? Math.max(...all.map((sample) => sample.t)) : Date.now() / 1000;
    domain = { start: end - LIVE_WINDOW_SECONDS, end, cursor: end };
  }
  if (Number.isFinite(state.hoverTime)) {
    domain.cursor = Math.max(domain.start, Math.min(domain.end, state.hoverTime));
  }
  return domain;
}

function handleChartPointerMove(event, chartName) {
  if (typeof linkedTraceActive === "function" && linkedTraceActive()) { handleLinkedPointer(event, chartName); return; }
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width) return;
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const domain = viewDomain();
  state.hoverTime = domain.start + fraction * (domain.end - domain.start);
  state.hoverChart = chartName;
  state.hoverFraction = fraction;
  state.hoverTopPx = Math.max(44, event.clientY - rect.top);
  if (state.mode === "replay") syncPlaybackToInspection();
  render();
}

function handleChartPointerLeave(chartName) {
  if (typeof linkedTraceActive === "function" && linkedTraceActive()) { clearLinkedPointer(); return; }
  if (state.hoverChart !== chartName) return;
  clearChartHover();
  render();
}

function cursorTimeLabel(domain) {
  if (state.mode === "replay") return `${domain.cursor.toFixed(2)}s`;
  return `−${Math.max(0, domain.end - domain.cursor).toFixed(1)}s`;
}

function updateChartTooltip(domain, samplesA, samplesB) {
  const speedTooltip = $("speed-tooltip");
  const inputTooltip = $("input-tooltip");
  if (!state.hoverChart || !Number.isFinite(state.hoverTime)) {
    speedTooltip.classList.add("hidden");
    inputTooltip.classList.add("hidden");
    return;
  }
  const tooltip = state.hoverChart === "speed" ? speedTooltip : inputTooltip;
  const otherTooltip = state.hoverChart === "speed" ? inputTooltip : speedTooltip;
  otherTooltip.classList.add("hidden");
  const sampleA = latestSample(samplesA, domain.cursor);
  const sampleB = latestSample(samplesB, domain.cursor);
  const leftPercent = Math.max(12, Math.min(88, (state.hoverFraction ?? 0.5) * 100));
  tooltip.style.left = `${leftPercent}%`;
  tooltip.style.top = `${state.hoverTopPx ?? 44}px`;
  if (state.hoverChart === "speed") {
    const valueA = Number.isFinite(sampleA?.speed) ? `${Math.round(sampleA.speed)}km/h` : "—";
    const valueB = Number.isFinite(sampleB?.speed) ? `${Math.round(sampleB.speed)}km/h` : "—";
    const delta = Number.isFinite(sampleA?.speed) && Number.isFinite(sampleB?.speed) ? sampleA.speed - sampleB.speed : null;
    const deltaLabel = delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}km/h`;
    tooltip.textContent = `X ${cursorTimeLabel(domain)} · ${shortName(state.selectedA)} Y ${valueA} · ${shortName(state.selectedB)} Y ${valueB} · Δ ${deltaLabel}`;
  } else {
    const inputValue = (sample) => sample ? `Y ${roundedOrNull(sample.throttle) ?? "—"}% · Brake ${Number.isFinite(sample.brake) ? sample.brake > 0 ? "ON" : "OFF" : "—"}` : "Y —";
    tooltip.textContent = `X ${cursorTimeLabel(domain)} · ${shortName(state.selectedA)} ${inputValue(sampleA)} · ${shortName(state.selectedB)} ${inputValue(sampleB)}`;
  }
  tooltip.classList.remove("hidden");
}

function visibleSamples(driverNumber, domain) {
  return (state.telemetry.get(Number(driverNumber)) || []).filter((sample) => sample.t >= domain.start && sample.t <= domain.end);
}

function svgPath(samples, accessor, domain, maxY, height) {
  const range = Math.max(0.001, domain.end - domain.start);
  let drawing=false;
  return samples.map((sample) => {
    const raw=numberOrNull(accessor(sample));
    if(raw===null) { drawing=false; return ""; }
    const x = ((sample.t - domain.start) / range) * 1000;
    const value = Math.max(0, Math.min(maxY, raw));
    const y = height - (value / maxY) * height;
    const command=drawing ? "L" : "M"; drawing=true;
    return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function setPath(id, samples, accessor, domain, maxY, height) {
  $(id).setAttribute("d", svgPath(samples, accessor, domain, maxY, height));
}

function renderBrakeBands(id, samples, domain, height, lane) {
  const range = Math.max(0.001, domain.end - domain.start);
  let html = "";
  let start = null;
  samples.forEach((sample, index) => {
    if (sample.brake > 0 && start === null) start = sample.t;
    const isEnd = !Number.isFinite(sample.brake) || sample.brake <= 0 || index === samples.length - 1;
    if (start !== null && isEnd) {
      const end = sample.t;
      const x = ((start - domain.start) / range) * 1000;
      const width = Math.max(2, ((end - start) / range) * 1000);
      html += `<rect x="${x.toFixed(2)}" y="${lane === "a" ? 0 : height / 2}" width="${width.toFixed(2)}" height="${height / 2}"></rect>`;
      start = null;
    }
  });
  $(id).innerHTML = html;
}

function updateReadout(prefix, sample) {
  const empty = sample == null;
  $(`speed-value-${prefix}`).textContent = roundedOrNull(sample?.speed) ?? "—";
  $(`throttle-${prefix}`).textContent = !Number.isFinite(sample?.throttle) ? "—%" : `${Math.round(sample.throttle)}%`;
  const brake = $(`brake-${prefix}`);
  brake.textContent = !Number.isFinite(sample?.brake) ? "—" : sample.brake > 0 ? "ON" : "OFF";
  brake.classList.toggle("brake-on", !empty && sample.brake > 0);
  $(`gear-${prefix}`).textContent = numberOrNull(sample?.n_gear) ?? "—";
  $(`rpm-${prefix}`).textContent = Number.isFinite(sample?.rpm) ? Math.round(sample.rpm).toLocaleString("en-US") : "—";
  const driver = prefix === "a" ? state.selectedA : state.selectedB;
  const drs = numberOrNull(sample?.drs);
  const year = Number(state.session?.year || new Date(state.session?.date_start).getUTCFullYear());
  $(`drs-${prefix}`).textContent = drs === null ? "—" : year >= 2026 ? `${drs} · RAW / UNVERIFIED` : `${drs} · ${[10,12,14].includes(drs) ? "ON" : [0,1].includes(drs) ? "OFF" : drs === 8 ? "ELIGIBLE" : "UNKNOWN"}`;
  const neighbours = (state.telemetry.get(Number(driver)) || []).filter((point) => sample && Number.isFinite(point.speed) && Math.abs(point.t - sample.t) <= 0.5);
  const ax = neighbours.length >= 3 ? linearRegression(neighbours.map((point) => ({ x: point.t, y: point.speed / 3.6 }))).slope : null;
  $(`ax-${prefix}`).textContent = Number.isFinite(ax) ? signed(ax, 1) : "—";
}

function rollingStats(samples) {
  if (!samples.length) return { min: null, full: null, brakes: null };
  let brakes = 0;
  let brakePairs=0;
  for (let index = 1; index < samples.length; index += 1) {
    if (!Number.isFinite(samples[index-1].brake) || !Number.isFinite(samples[index].brake)) continue;
    brakePairs++;
    if (samples[index - 1].brake === 0 && samples[index].brake > 0) brakes += 1;
  }
  return {
    min: samples.some(s=>Number.isFinite(s.speed)) ? Math.min(...samples.map(s=>s.speed).filter(Number.isFinite)) : null,
    full: samples.some(s=>Number.isFinite(s.throttle)) ? samples.filter(s=>Number.isFinite(s.throttle)&&s.throttle>=95).length / samples.filter(s=>Number.isFinite(s.throttle)).length * 100 : null,
    brakes: brakePairs ? brakes : null,
  };
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function linearRegression(points) {
  const clean = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (clean.length < 2) return { slope: null, intercept: null, r2: null };
  const xMean = mean(clean.map((point) => point.x));
  const yMean = mean(clean.map((point) => point.y));
  const denominator = clean.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  if (denominator <= 1e-9) return { slope: null, intercept: yMean, r2: null };
  const slope = clean.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator;
  const intercept = yMean - slope * xMean;
  const residual = clean.reduce((sum, point) => sum + (point.y - (intercept + slope * point.x)) ** 2, 0);
  const total = clean.reduce((sum, point) => sum + (point.y - yMean) ** 2, 0);
  return { slope, intercept, r2: total > 1e-9 ? Math.max(0, 1 - residual / total) : null };
}

function interpolateField(samples, x, xKey, valueKey) {
  if (!samples?.length || !Number.isFinite(x)) return null;
  const numeric = numberOrNull;
  if (x <= samples[0][xKey]) return numeric(samples[0][valueKey]);
  if (x >= samples[samples.length - 1][xKey]) return numeric(samples[samples.length - 1][valueKey]);
  let low = 0;
  let high = samples.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle][xKey] < x) low = middle + 1;
    else high = middle - 1;
  }
  const right = samples[Math.min(samples.length - 1, low)];
  const left = samples[Math.max(0, low - 1)];
  const span = Number(right[xKey]) - Number(left[xKey]);
  const lv = numeric(left[valueKey]), rv = numeric(right[valueKey]);
  if (lv === null || rv === null) return null;
  if (Math.abs(span) < 1e-9) return lv;
  const fraction = (x - Number(left[xKey])) / span;
  return lv + fraction * (rv - lv);
}

function buildLapDistancePath(data) {
  const lapDuration = Number(data?.lap?.lap_duration);
  const raw = (data?.locations || []).filter((point) => Number.isFinite(point.t) && Number.isFinite(point.x) && Number.isFinite(point.y) && point.t >= 0 && point.t <= lapDuration).sort((a,b) => a.t-b.t);
  if (raw.length < 20 || !Number.isFinite(lapDuration)) return null;

  const smoothed = raw.map((point, index) => {
    // A truncated 3/4-point window shifts endpoint coordinates in time.
    // Preserve both edge samples at each end; never move their timestamps.
    if (index < 2 || index >= raw.length - 2) return {t:point.t,x:point.x,y:point.y};
    const window = raw.slice(Math.max(0, index - 2), Math.min(raw.length, index + 3));
    return { t: point.t, x: median(window.map((item) => item.x)), y: median(window.map((item) => item.y)) };
  });
  const steps = smoothed.slice(1).map((point, index) => Math.hypot(point.x - smoothed[index].x, point.y - smoothed[index].y)).filter((step) => step > 0);
  const typicalStep = median(steps) || 1;
  const jumpLimit = typicalStep * 6;
  const accepted = [smoothed[0]];
  for (let index = 1; index < smoothed.length; index += 1) {
    const previous = accepted[accepted.length - 1];
    const step = Math.hypot(smoothed[index].x - previous.x, smoothed[index].y - previous.y);
    if (step <= jumpLimit && smoothed[index].t > previous.t) accepted.push(smoothed[index]);
  }
  if (accepted.length < 20) return null;

  let distance = 0;
  const path = accepted.map((point, index) => {
    if (index) distance += Math.hypot(point.x - accepted[index - 1].x, point.y - accepted[index - 1].y);
    return { ...point, distance };
  });
  if (distance <= 0) return null;
  path.forEach((point) => { point.progress = point.distance / distance; });

  const telemetry = (data.telemetry || []).filter((sample) => sample.t >= path[0].t && sample.t <= path.at(-1).t && sample.t <= lapDuration).map((sample) => {
    return { ...sample, tAligned: sample.t, progress: interpolateField(path, sample.t, "t", "progress") };
  }).filter((sample) => Number.isFinite(sample.progress)).sort((a, b) => a.progress - b.progress);
  const startMissing = Math.max(0, path[0].t);
  const endMissing = Math.max(0, lapDuration - path.at(-1).t);
  const maxGap = Math.max(...path.slice(1).map((p, i) => p.t - path[i].t));
  const coverage = Math.max(0, Math.min(1, (path.at(-1).t - path[0].t) / lapDuration));
  const quality = { startMissing, endMissing, maxGap, coverage, rejected: raw.length - accepted.length };
  quality.medianGap = median(path.slice(1).map((p,i) => p.t-path[i].t));
  quality.localGapLimit = Math.min(2, 3 * quality.medianGap);
  quality.usable = coverage >= 0.98 && maxGap <= 2 && startMissing <= 1.2 && endMissing <= 1.2;
  return { path, telemetry, lapDuration, acceptedSamples: accepted.length, rawSamples: raw.length, quality };
}

// Both laps use A's approximate path. B is projected to nearby A segments;
// a local search window prevents cross-track shortcuts at adjacent track sections.
function projectOntoReference(lap, reference) {
  let previous = -Infinity;
  let reversals = 0;
  let outsideReference = 0;
  lap.path = lap.path.map((point) => {
    let best = null;
    for (let i = 1; i < reference.path.length; i += 1) {
      const a = reference.path[i - 1], b = reference.path[i];
      if (Math.abs((a.progress + b.progress) / 2 - point.progress) > 0.06) continue;
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const rawU = length2 ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2 : 0;
      const u = Math.max(0,Math.min(1,rawU));
      const error = Math.hypot(point.x - a.x - u * dx, point.y - a.y - u * dy);
      if (!best || error < best.error) best = { error, progress: a.progress + u * (b.progress - a.progress), outside:(i===1 && rawU < -1e-9)||(i===reference.path.length-1 && rawU > 1+1e-9) };
    }
    // Do not clamp an observation outside A's measured path to p=0 or p=1
    // and then claim it occurred at the reference endpoint's timestamp.
    if (!best || best.outside) { outsideReference++; return null; }
    let progress = best?.progress ?? point.progress;
    if (progress < previous) { reversals++; progress = previous; }
    previous = progress;
    return { ...point, progress, projectionError: best?.error ?? null };
  }).filter(Boolean);
  lap.quality.projectionReversals = reversals;
  lap.quality.outsideReference = outsideReference;
  lap.quality.referenceSamples = lap.path.length;
  if (lap.path.length < 2) { lap.quality.usable=false; lap.telemetry=[]; return; }
  if (reversals / lap.path.length > 0.05) lap.quality.usable = false;
  lap.telemetry = lap.telemetry.filter(sample=>sample.t>=lap.path[0].t&&sample.t<=lap.path.at(-1).t).map((sample) => ({ ...sample, progress: interpolateField(lap.path, sample.t, "t", "progress") }));
}

function observedAt(samples, progress, field) {
  if (!samples.length || !Number.isFinite(progress) || progress < samples[0].progress || progress > samples.at(-1).progress) return null;
  const bracket = progressSupport(samples, progress);
  if (!bracket || bracket.gap > 2 || bracket.ambiguous) return null;
  return interpolateField(samples, progress, "progress", field);
}

function localDeltaAt(lapA, lapB, progress) {
  if (!lapA.quality.usable || !lapB.quality.usable) return null;
  for (const lap of [lapA, lapB]) {
    const support = progressSupport(lap.path, progress);
    if (!support || support.ambiguous || support.gap > lap.quality.localGapLimit) return null;
  }
  const a = observedAt(lapA.path, progress, "t"), b = observedAt(lapB.path, progress, "t");
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}

function localDeltaRangeSupported(lapA, lapB, start, end) {
  if (![localDeltaAt(lapA,lapB,start),localDeltaAt(lapA,lapB,end)].every(Number.isFinite)) return false;
  for (const lap of [lapA,lapB]) {
    for (let i=1;i<lap.path.length;i++) {
      const a=lap.path[i-1], b=lap.path[i];
      if (b.progress < start || a.progress > end) continue;
      if (b.t-a.t > lap.quality.localGapLimit || b.progress===a.progress) return false;
    }
  }
  return true;
}

// Support is reported separately from the interpolated value. No interpolation
// across >2s gaps or many-to-one (plateau) progress; this is not an error bound.
function progressSupport(samples, progress) {
  if (!samples?.length || !Number.isFinite(progress) || progress < samples[0].progress || progress > samples.at(-1).progress) return null;
  let low = 0, high = samples.length - 1;
  while (low < high) { const mid = (low + high) >> 1; if (samples[mid].progress < progress) low = mid + 1; else high = mid; }
  const right = samples[low], left = samples[Math.max(0, low - 1)];
  const ambiguous = Math.abs(right.progress - progress) < 1e-10 && (samples[low + 1]?.progress === right.progress || (low > 0 && left.progress === right.progress));
  return { left, right, gap: right.t - left.t, ambiguous };
}

function movingAverage(values, radius = 2) {
  return values.map((_, index) => mean(values.slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1))) ?? values[index]);
}

function detectCorners(grid, lapA = null, lapB = null) {
  if (grid.length < 30) return [];
  const rawSpeed = grid.map(point=>Number.isFinite(point.speedA)&&Number.isFinite(point.speedB)?mean([point.speedA,point.speedB]):null);
  const referenceSpeed = movingAverage(rawSpeed, 3);
  const candidates = [];
  for (let index = 8; index < referenceSpeed.length - 8; index += 1) {
    if(rawSpeed.slice(index-8,index+9).some(value=>!Number.isFinite(value))) continue;
    const value = referenceSpeed[index];
    if (value > referenceSpeed[index - 1] || value > referenceSpeed[index + 1]) continue;
    const leftPeak = Math.max(...referenceSpeed.slice(index - 8, index));
    const rightPeak = Math.max(...referenceSpeed.slice(index + 1, index + 9));
    const prominence = Math.min(leftPeak - value, rightPeak - value);
    if (value < 330 && prominence >= 8) candidates.push({ index, progress: grid[index].progress, prominence });
  }
  const selected = [];
  candidates.sort((a, b) => b.prominence - a.prominence).forEach((candidate) => {
    if (selected.length < 18 && selected.every((item) => Math.abs(item.progress - candidate.progress) >= 0.025)) selected.push(candidate);
  });
  selected.sort((a, b) => a.progress - b.progress);
  return selected.map((corner, index) => {
    const previousApex = selected[index - 1]?.progress ?? Math.max(0, corner.progress - 0.07);
    const nextApex = selected[index + 1]?.progress ?? Math.min(1, corner.progress + 0.07);
    const entryProgress = Math.max(0, (previousApex + corner.progress) / 2);
    const exitProgress = Math.min(1, (corner.progress + nextApex) / 2);
    const at = (progress) => grid[Math.max(0, Math.min(grid.length - 1, Math.round(progress * (grid.length - 1))))];
    const entry = at(entryProgress);
    const apex = grid[corner.index];
    const exit = at(exitProgress);
    const inputClass = (driver) => {
      const points = grid.filter((p) => p.progress >= Math.max(entryProgress,corner.progress-0.015) && p.progress <= corner.progress);
      if (points.some((p) => p[`brake${driver}`] > 0)) return "BRAKING";
      if (points.some((p) => Number.isFinite(p[`throttle${driver}`]) && p[`throttle${driver}`] < 95)) return "LIFT";
      return "FLAT / UNKNOWN";
    };
    return {
      number: index + 1,
      progress: corner.progress,
      entry,
      apex,
      exit,
      segmentDelta: (!lapA || localDeltaRangeSupported(lapA,lapB,entry.progress,exit.progress)) && grid.filter(p=>p.progress>=entry.progress&&p.progress<=exit.progress).every(p=>Number.isFinite(p.delta)) && Number.isFinite(exit.delta) && Number.isFinite(entry.delta) ? exit.delta - entry.delta : null,
      inputA: inputClass("A"), inputB: inputClass("B"),
    };
  });
}

function resetPerformanceAnalysis() {
  state.distanceAnalysis = null;
  state.sessionContext = null;
  state.stints = [];
  state.stintsSessionKey = null;
  state.stintsStatus = "idle";
  state.paceRows = [];
  state.contextLoading = false;
  clearDistancePointer();
  renderDistancePerformanceAnalysis();
  renderPaceAnalysis();
  renderStrategyAnalysis();
}

function buildDistancePerformanceAnalysis() {
  if (state.mode !== "replay") { state.distanceAnalysis = null; renderDistancePerformanceAnalysis(); return; }
  const dataA = state.replayData.get(Number(state.selectedA));
  const dataB = state.replayData.get(Number(state.selectedB));
  const lapA = buildLapDistancePath(dataA);
  const lapB = buildLapDistancePath(dataB);
  if (!lapA || !lapB) {
    state.distanceAnalysis = null;
    renderDistancePerformanceAnalysis();
    return;
  }
  const pairKey = `${state.session?.session_key}:${state.selectedA}:${dataA.lap.lap_number}:${dataA.lap.date_start}:${state.selectedB}:${dataB.lap.lap_number}:${dataB.lap.date_start}`;
  const previousPair = state.distanceAnalysis?.pairKey;
  projectOntoReference(lapB, lapA);
  if(lapB.path.length<2) { state.distanceAnalysis=null; renderDistancePerformanceAnalysis(); return; }
  const grid = Array.from({ length: 251 }, (_, index) => {
    const progress = index / 250;
    const tA = observedAt(lapA.path, progress, "t");
    const tB = observedAt(lapB.path, progress, "t");
    return {
      progress,
      tA,
      tB,
      delta: localDeltaAt(lapA, lapB, progress),
      speedA: observedAt(lapA.telemetry, progress, "speed"),
      speedB: observedAt(lapB.telemetry, progress, "speed"),
      throttleA: observedAt(lapA.telemetry, progress, "throttle"),
      throttleB: observedAt(lapB.telemetry, progress, "throttle"),
      brakeA: Number.isFinite(tA) && Number.isFinite(observedAt(lapA.telemetry, progress, "brake")) ? latestSample(lapA.telemetry, tA)?.brake : null,
      brakeB: Number.isFinite(tB) && Number.isFinite(observedAt(lapB.telemetry, progress, "brake")) ? latestSample(lapB.telemetry, tB)?.brake : null,
      positionGapA: progressSupport(lapA.path, progress)?.gap ?? null,
      positionGapB: progressSupport(lapB.path, progress)?.gap ?? null,
    };
  });
  state.distanceAnalysis = {
    pairKey,
    lapA,
    lapB,
    grid,
    corners: detectCorners(grid, lapA, lapB),
    finishDelta: Number(dataA.lap.lap_duration) - Number(dataB.lap.lap_duration),
  };
  if (pairKey !== previousPair) {
    state.progressWindow = [0, 1];
    state.tracePointer = null;
    state.traceDrag = null;
  }
  $("alignment-note").textContent = tr("Top plots use lap elapsed time. DISTANCE uses A's approximate path as a shared reference; timestamps are not stretched. Not official distance or a racing-line analysis.", "위 그래프는 랩 경과시간 기준입니다. DISTANCE는 A의 근사 위치 경로를 공통 기준으로 사용하며 시간을 늘이지 않습니다. 공식 거리·레이싱라인 분석이 아닙니다.");
  renderDistancePerformanceAnalysis();
}

function signed(value, digits = 3) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function renderDistancePerformanceAnalysis() {
  const analysis = state.distanceAnalysis;
  if (!analysis) {
    ["distance-finish-delta", "distance-max-gain", "distance-max-loss", "distance-samples"].forEach((id) => { if ($(id)) $(id).textContent = "—"; });
    if ($("corner-table-body")) $("corner-table-body").innerHTML = `<tr><td colspan="5">${tr("Waiting for aligned lap data", "거리 정렬 데이터 대기 중")}</td></tr>`;
    if ($("analysis-status")) $("analysis-status").textContent = state.mode === "live" ? "Available in replay" : "Load two laps";
    if ($("gate-observed")) $("gate-observed").textContent = "No laps loaded";
    return;
  }

  const deltas = analysis.grid.map((point) => point.delta).filter(Number.isFinite);
  const minDelta = deltas.length ? Math.min(...deltas) : 0;
  const maxDelta = deltas.length ? Math.max(...deltas) : 0;
  $("distance-finish-delta").textContent = signed(analysis.finishDelta);
  $("distance-max-gain").textContent = deltas.length ? Math.max(0, -minDelta).toFixed(2) : "—";
  $("distance-max-loss").textContent = deltas.length ? Math.max(0, maxDelta).toFixed(2) : "—";
  $("distance-samples").textContent = Math.min(analysis.lapA.acceptedSamples, analysis.lapB.acceptedSamples);
  $("analysis-status").textContent = `${sessionTitle(state.session)} · ${deltas.length ? "Estimated alignment" : "Alignment unavailable"}`;
  $("gate-observed").textContent = deltas.length ? "Available for comparison" : "Alignment unavailable";

  const triplet = (corner, driver) => [corner.entry, corner.apex, corner.exit]
    .map((point) => { const speed = driver === "a" ? point.speedA : point.speedB; return Number.isFinite(speed) ? Math.round(speed) : "—"; })
    .join(" / ");
  $("corner-table-body").innerHTML = analysis.corners.length ? analysis.corners.map((corner) => {
    const cls = corner.segmentDelta >= 0 ? "delta-positive" : "delta-negative";
    return `<tr><td>Z${corner.number}</td><td>${(corner.entry.progress * 100).toFixed(1)}–${(corner.exit.progress * 100).toFixed(1)}%<br>A ${corner.inputA} / B ${corner.inputB}</td><td>${shortName(state.selectedA)} · ${triplet(corner, "a")}km/h</td><td>${shortName(state.selectedB)} · ${triplet(corner, "b")}km/h</td><td class="${cls}">${Number.isFinite(corner.segmentDelta)?signed(corner.segmentDelta, 2)+"s":tr("Withheld: sparse / unsupported location interval","보류: 위치 표본 희소 / 구간 지원 부족")}</td></tr>`;
  }).join("") : `<tr><td colspan="5">${tr("No windows meet the speed-minimum detection criteria.", "자동 최저속도 탐지 기준을 만족하는 구간이 없습니다.")}</td></tr>`;
}

function isRaceLikeSession() {
  const name = String(state.session?.session_name || "").toLowerCase();
  const type = String(state.session?.session_type || "").toLowerCase();
  return type === "race" || name === "race" || name === "sprint";
}

function validLap(lap) {
  return Number(lap?.lap_duration) > 0 && lap.date_start && !lap.is_pit_out_lap && !lap.is_pit_in_lap && !lap.deleted && lap.is_accurate !== false;
}

function estimateTrackEvolution() {
  if (state.source === "demo") return { slope: null, reason: "frozen_subset" };
  if (isRaceLikeSession()) {
    return {
      slope: null,
      intercept: null,
      r2: null,
      reason: "race_confounding",
    };
  }
  const byDriver = new Map();
  state.laps.filter(validLap).forEach((lap) => {
    const driver = Number(lap.driver_number);
    if (!byDriver.has(driver)) byDriver.set(driver, []);
    byDriver.get(driver).push(lap);
  });
  const startMs = Date.parse(state.session?.date_start || "");
  const points = [];
  byDriver.forEach((laps) => {
    const best = Math.min(...laps.map((lap) => Number(lap.lap_duration)));
    const representative = laps.filter((lap) => Number(lap.lap_duration) <= best * 1.07);
    const paired=representative.map(lap=>({x:(Date.parse(lap.date_start)-startMs)/3_600_000,y:Number(lap.lap_duration)})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    const xMean=mean(paired.map(p=>p.x)), yMean=mean(paired.map(p=>p.y));
    paired.forEach(point => {
      points.push({x:point.x-xMean,y:point.y-yMean});
    });
  });
  return linearRegression(points);
}

function trafficIntervalForLap(intervals, lap) {
  if (!intervals?.length || !validLap(lap)) return null;
  const start = Date.parse(lap.date_start);
  const end = start + Number(lap.lap_duration) * 1000;
  const values = intervals.filter((sample) => {
    const time = Date.parse(sample.date);
    return time >= start && time <= end;
  }).map((sample) => {
    if (sample.interval === null || sample.interval === undefined || sample.interval === "") return NaN;
    return Number(sample.interval);
  }).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function modelFuelGain() {
  return strategyInputs().fuelGain;
}

function buildPaceRows() {
  const context = state.sessionContext;
  if (!context) {
    state.paceRows = [];
    renderPaceAnalysis();
    renderStrategyAnalysis();
    return;
  }
  const raceLike = isRaceLikeSession();
  const fuelGain = modelFuelGain();
  const trackModel = estimateTrackEvolution();
  const sessionStart = Date.parse(state.session?.date_start || "");
  const selected = new Set([Number(state.selectedA), Number(state.selectedB)]);
  const pitLapsByDriver = new Map();
  context.pits.forEach((pit) => {
    const driver = Number(pit.driver_number);
    if (!pitLapsByDriver.has(driver)) pitLapsByDriver.set(driver, new Set());
    pitLapsByDriver.get(driver).add(Number(pit.lap_number));
  });

  state.paceRows = context.stints.filter((stint) => selected.has(Number(stint.driver_number))).map((stint) => {
    const driver = Number(stint.driver_number);
    const allStintLaps = state.laps.filter((lap) => Number(lap.driver_number) === driver && Number(lap.lap_number) >= Number(stint.lap_start) && Number(lap.lap_number) <= Number(stint.lap_end) && validLap(lap)).sort((a,b)=>Number(a.lap_number)-Number(b.lap_number));
    if (!allStintLaps.length) return null;
    const best = Math.min(...allStintLaps.map((lap) => Number(lap.lap_duration)));
    const plausible = allStintLaps.filter((lap) => Number(lap.lap_duration) <= best * 1.08 && !pitLapsByDriver.get(driver)?.has(Number(lap.lap_number)));
    const intervals = context.intervals.get(driver) || [];
    let trafficExcluded = 0;
    const clean = plausible.filter((lap) => {
      const interval = trafficIntervalForLap(intervals, lap);
      const traffic = raceLike && typeof RaceEngine!=="undefined" && RaceEngine.trafficExposure(intervals,driver,Date.parse(lap.date_start),Date.parse(lap.date_start)+Number(lap.lap_duration)*1000).fraction>.2;
      if (traffic) trafficExcluded += 1;
      return !traffic;
    }).map((lap) => {
      const hours = (Date.parse(lap.date_start) - sessionStart) / 3_600_000;
      const fuelCorrection = raceLike ? fuelGain * Math.max(0, Number(lap.lap_number) - 1) : 0;
      const trackCorrection = Number.isFinite(trackModel.slope) ? -trackModel.slope * Math.max(0, hours) : 0;
    const tyreAge = tyreAgeForLap(lap,stint);
      return { lap, tyreAge, fuelCorrection, trackCorrection, corrected: Number(lap.lap_duration) + fuelCorrection + trackCorrection };
    });
    const fitLaps=clean.filter(item=>Number.isFinite(item.tyreAge)&&Number.isFinite(item.corrected));
    const regression = linearRegression(fitLaps.map((item) => ({ x: item.tyreAge, y: item.corrected })));
    const degradation = Number.isFinite(regression.slope) ? regression.slope : null;
    const basePace = Number.isFinite(degradation) ? regression.intercept : null;
    return {
      driver,
      stintNumber: Number(stint.stint_number),
      compound: stint.compound || "UNKNOWN",
      lapStart: Number(stint.lap_start),
      lapEnd: Number(stint.lap_end),
      tyreAgeStart: numberOrNull(stint.tyre_age_at_start),
      currentAge: clean.length ? clean.at(-1).tyreAge : null,
      usable: clean.length,
      fitLaps: fitLaps.length,
      missingTyreAge: clean.length - fitLaps.length,
      trafficExcluded,
      rawPace: median(clean.map((item) => Number(item.lap.lap_duration))),
      fuelCorrection: mean(clean.map((item) => item.fuelCorrection)),
      trackCorrection: mean(clean.map((item) => item.trackCorrection)),
      correctedPace: median(clean.map((item) => item.corrected)),
      basePace,
      degradation,
      r2: fitLaps.length > 2 ? regression.r2 : null,
      fitStatus: fitLaps.length !== clean.length ? "missing_tyre_age" : fitLaps.length <= 2 ? "limited_laps" : "in_sample_only",
    };
  }).filter(Boolean);
  context.trackModel = trackModel;
  renderPaceAnalysis();
  renderStrategyAnalysis();
}

function latestWeatherSample() {
  const weather = state.sessionContext?.weather || [];
  return [...weather].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0] || null;
}

function renderPaceAnalysis() {
  const context = state.sessionContext;
  const rows = state.paceRows;
  if (!context) {
    if ($("stint-table-body")) $("stint-table-body").innerHTML = `<tr><td colspan="8">${tr("Load pace & strategy context first.", "PACE & STRATEGY를 먼저 불러와주세요.")}</td></tr>`;
    ["track-evolution", "traffic-a", "traffic-b", "track-condition"].forEach((id) => { if ($(id)) $(id).textContent = "—"; });
    if ($("track-evolution-note")) $("track-evolution-note").textContent = tr("Waiting for session context", "세션 모델 대기");
    if ($("track-condition-note")) $("track-condition-note").textContent = "weather data";
    return;
  }
  const slope = context.trackModel?.slope;
  $("track-evolution").textContent = Number.isFinite(slope) ? `${signed(slope, 2)}s/h` : "N/A";
  $("track-evolution-note").textContent = context.trackModel?.reason === "race_confounding"
    ? tr("Not identifiable separately from race fuel / tyres", "레이스 연료·타이어와 분리 식별 불가")
    : context.trackModel?.reason === "frozen_subset" ? tr("Disabled: small frozen qualifying subset", "작은 동결 예선 부분집합이므로 꺼짐") : tr("Driver-centred session trend proxy", "드라이버 중심 세션 추세 프록시");
  [state.selectedA, state.selectedB].forEach((driver, index) => {
    const intervals = context.intervals.get(Number(driver)) || [];
    const affected = state.laps.filter((lap) => {
      if (Number(lap.driver_number) !== Number(driver)) return false;
      const interval = trafficIntervalForLap(intervals, lap);
      return typeof RaceEngine!=="undefined" && RaceEngine.trafficExposure(intervals,Number(driver),Date.parse(lap.date_start),Date.parse(lap.date_start)+Number(lap.lap_duration)*1000).fraction>.2;
    }).length;
    const trafficAvailable = context.intervalAvailability?.get(Number(driver));
    $(`traffic-${index === 0 ? "a" : "b"}`).textContent = isRaceLikeSession() && trafficAvailable ? `${affected} laps` : "N/A";
  });
  const weather = latestWeatherSample();
  if (weather) {
    $("track-condition").textContent = numberOrNull(weather.rainfall) === null ? "N/A" : Number(weather.rainfall) > 0 ? tr("RAIN REPORTED", "강수 보고") : tr("NO RAIN REPORTED", "강수 보고 없음");
    const temperature = (value) => numberOrNull(value) !== null ? `${Number(value).toFixed(1)}°C` : "N/A";
    $("track-condition-note").textContent = `track ${temperature(weather.track_temperature)} · air ${temperature(weather.air_temperature)}`;
  } else {
    $("track-condition").textContent = "N/A";
    $("track-condition-note").textContent = "weather sample unavailable";
  }
  $("stint-table-body").innerHTML = rows.length ? rows.map((row) => {
    const degradation = Number.isFinite(row.degradation) ? `${signed(row.degradation, 3)}s/lap${row.usable === 2 ? `<br><small>${tr("Two-point change only", "두 점 사이 변화만 표시")}</small>` : ""}` : tr("Insufficient", "부족");
    const fit = row.missingTyreAge ? `<strong class="limited-fit">${tr("Tyre age missing", "타이어 사용 랩 누락")}</strong><br>${row.fitLaps} ${tr("fit laps", "적합 랩")}` : row.fitLaps <= 2 ? `<strong class="limited-fit">${tr(`${row.fitLaps} laps · limited interpretation`, `${row.fitLaps}개 랩 · 해석 제한`)}</strong><br><small>${tr("Not degradation evidence", "열화의 근거가 아님")}</small>` : `${Number.isFinite(row.r2) ? `R² ${row.r2.toFixed(2)}` : "—"}<br><small>${tr("In-sample fit, not confidence", "표본 내 적합도 · 신뢰도 아님")}</small>`;
    const usable = `${row.usable}${row.trafficExcluded ? ` · ${row.trafficExcluded} traffic out` : ""}`;
    return `<tr><td>${shortName(row.driver)}</td><td>S${row.stintNumber} · ${row.compound}<br>L${row.lapStart}–${row.lapEnd}</td><td>${usable}</td><td>${Number.isFinite(row.rawPace) ? row.rawPace.toFixed(3) : "—"}s</td><td>${Number.isFinite(row.fuelCorrection) ? signed(row.fuelCorrection, 3) : "—"}s</td><td>${Number.isFinite(row.trackCorrection) ? signed(row.trackCorrection, 3) : "—"}s</td><td>${degradation}</td><td>${fit}</td></tr>`;
  }).join("") : `<tr><td colspan="8">${tr("No usable stints for the selected drivers.", "선택 드라이버의 분석 가능한 stint가 없습니다.")}</td></tr>`;
}

function resolveInput(raw,lo,hi,dflt,isInt=false) {
  const s=String(raw??"").trim(),fallback=Math.min(hi,Math.max(lo,dflt));
  if(s==="")return {v:fallback,note:tr(`empty · using ${fallback}`,`비어 있음 · ${fallback} 적용`)};
  const n=Number(s);
  if(!Number.isFinite(n))return {v:fallback,note:tr(`not a number · using ${fallback}`,`숫자 아님 · ${fallback} 적용`)};
  const c=Math.min(hi,Math.max(lo,isInt?Math.round(n):n));
  return {v:c,note:c!==n?tr(`${s} → ${c} (${lo}–${hi})`,`${s} 입력 · ${c} 적용 (${lo}–${hi})`):null};
}
function strategyInputs() {
  const read = (id, fallback, min, max) => {
    const value = numberOrNull($(id)?.value);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  };
  const horizon=Math.round(read("strategy-horizon",12,3,30));
  return {
    horizon,
    delay: Math.min(horizon-1, Math.round(read("strategy-delay",3,1,29))),
    warmup: read("strategy-warmup", 0.6, 0, 5),
    fuelGain: read("strategy-fuel-gain", 0.035, 0, 0.15),
    pitLoss: read("strategy-pit-loss", 22, 10, 40),
    scFactor: read("strategy-sc-factor", 0.6, 0.35, 0.9),
    vscFactor: read("strategy-vsc-factor", 0.75, 0.35, 0.95),
  };
}

function syncStrategyControls({commit=false} = {}) {
  const values=strategyInputs();
  const keys={"strategy-horizon":"horizon","strategy-delay":"delay","strategy-warmup":"warmup","strategy-fuel-gain":"fuelGain","strategy-pit-loss":"pitLoss","strategy-sc-factor":"scFactor","strategy-vsc-factor":"vscFactor"};
  $("strategy-delay").max=values.horizon-1;
  for(const [id,key] of Object.entries(keys)) {
    const input=$(id);
    if(!input)continue;
    const resolved=resolveInput(input.value,Number(input.min),Number(input.max),Number(input.defaultValue),input.step==="1");
    if(id==="strategy-delay"&&Number(input.value)>values.horizon-1)resolved.note=tr(`${input.value} → ${values.delay} (H−1 limit)`,`${input.value} 입력 · ${values.delay} 적용 (H−1 상한)`);
    const note=$(id+"-effective");if(note){note.textContent=resolved.note||"";input.closest("label").classList.toggle("adj",!!resolved.note);}
    if(commit)input.value=String(values[key]);
  }
  if($("strategy-effective")) $("strategy-effective").textContent=tr(`Applied: horizon ${values.horizon} laps · delay ${values.delay} laps · fuel gain ${values.fuelGain}s/lap.`, `적용값: ${values.horizon}랩 범위 · ${values.delay}랩 지연 · 연료효과 ${values.fuelGain}s/lap.`);
  return values;
}

function representativePaceRow(driver) {
  return state.paceRows.filter((row) => Number(row.driver) === Number(driver) && Number.isFinite(row.basePace) && Number.isFinite(row.degradation) && Number.isFinite(row.currentAge) && row.fitLaps >= 3 && !row.missingTyreAge)
    .sort((a, b) => b.lapEnd - a.lapEnd)[0] || null;
}

function predictedPace(row, age) {
  return Number.isFinite(row?.basePace) && Number.isFinite(row?.degradation) && Number.isFinite(age) ? row.basePace + row.degradation * Math.max(0, age) : null;
}

function simulateStop(row, inputs, stopOffset) {
  let total = 0;
  const warmupPenalty = inputs.warmup ?? 0.6;
  for (let lap = 0; lap < inputs.horizon; lap += 1) {
    const afterStop = lap >= stopOffset;
    const age = afterStop ? lap - stopOffset : row.currentAge + lap;
    total += predictedPace(row, age) - inputs.fuelGain * lap;
    if (lap === stopOffset) total += inputs.pitLoss + warmupPenalty;
  }
  return total;
}

function bestStopWindow(row, inputs) {
  const scenarios = Array.from({ length: inputs.horizon }, (_, offset) => ({ offset, total: simulateStop(row, inputs, offset) }));
  return scenarios.sort((a, b) => a.total - b.total)[0];
}

function renderStrategyAnalysis() {
  if (!$("strategy-result-a")) return;
  $("strategy-name-a").textContent = `${shortName(state.selectedA)} · DELAY − PIT NOW`;
  $("strategy-name-b").textContent = `${shortName(state.selectedB)} · DELAY − PIT NOW`;
  const rowA = representativePaceRow(state.selectedA);
  const rowB = representativePaceRow(state.selectedB);
  const inputs = syncStrategyControls();
  $("sc-saving").textContent = `${(inputs.pitLoss * (1 - inputs.scFactor)).toFixed(1)} / ${(inputs.pitLoss * (1 - inputs.vscFactor)).toFixed(1)}s`;
  $("sc-detail").textContent = tr("SC / VSC · assumed saving vs green-flag pit loss", "SC / VSC · 가정한 정상 주행 대비 피트 손실 절감");
  if (!state.sessionContext || !rowA || !rowB || !isRaceLikeSession()) {
    ["strategy-result-a", "strategy-result-b", "undercut-result"].forEach((id) => { $(id).textContent = "—"; });
    $("strategy-detail-a").textContent = tr("Requires race stint data with at least 3 usable laps; qualifying is not a race tyre model. Three laps alone do not establish validity.", "유효 랩 3개 이상의 레이스 stint가 필요합니다. 예선은 레이스 타이어 모델이 아니며 3개 랩 자체도 타당성을 보증하지 않습니다.");
    $("strategy-detail-b").textContent = $("strategy-detail-a").textContent;
    $("undercut-detail").textContent = tr("Unavailable · no position or out-lap prediction", "계산 불가 · 순위·아웃랩 예측이 아닙니다");
    $("race-control-note").textContent = tr("SC/VSC numbers are hypothetical savings, not observed interventions.", "SC/VSC 값은 가정 기반 절감량이며 실제 개입 결과가 아닙니다.");
    return;
  }
  const delay = inputs.delay;
  [[rowA, "a"], [rowB, "b"]].forEach(([row, prefix]) => {
    const pitNow = simulateStop(row, inputs, 0);
    const delayed = simulateStop(row, inputs, delay);
    $(`strategy-result-${prefix}`).textContent = `${signed(delayed - pitNow, 2)}s`;
    $(`strategy-detail-${prefix}`).textContent = `${row.compound} · +${delay} laps / ${inputs.horizon}-lap horizon · ${tr("scenario starts at last usable lap's starting age", "마지막 유효 랩 시작 나이에서 출발하는 가정")} ${row.currentAge}`;
  });
  const undercut = predictedPace(rowB, rowB.currentAge) - (predictedPace(rowA, 0) + inputs.warmup);
  $("undercut-result").textContent = `${signed(undercut, 2)}s`;
  $("undercut-detail").textContent = `${shortName(state.selectedA)} fresh-tyre pace + ${inputs.warmup}s assumption vs ${shortName(state.selectedB)} old-tyre pace; not an out-lap model`;
  const scSaving = inputs.pitLoss * (1 - inputs.scFactor);
  const vscSaving = inputs.pitLoss * (1 - inputs.vscFactor);
  $("sc-saving").textContent = `${scSaving.toFixed(1)} / ${vscSaving.toFixed(1)}s`;
  $("sc-detail").textContent = `SC / VSC · pit loss ${inputs.pitLoss.toFixed(1)}s assumption`;

  const controls = state.sessionContext.raceControl || [];
  const vscCount = controls.filter((item) => /VIRTUAL SAFETY CAR|\bVSC\b/i.test(String(item.message || ""))).length;
  const scCount = controls.filter((item) => /SAFETY CAR/i.test(String(item.message || "")) && !/VIRTUAL|\bVSC\b/i.test(String(item.message || ""))).length;
  $("race-control-note").textContent = controls.length
    ? `SC ${scCount}, VSC ${vscCount} ${tr("messages, not interventions. Savings are hypothetical.", "메시지이며 개입 횟수가 아닙니다. 절감량은 가정입니다.")}`
    : tr("No race-control messages loaded. SC/VSC savings are hypothetical.", "불러온 race-control 메시지가 없습니다. SC/VSC 절감은 가정입니다.");
}

async function loadSessionContext({ force = false } = {}) {
  if (state.source === "demo") { buildPaceRows(); updateLabDetails(); return; }
  if (state.mode !== "replay" || state.source !== "openf1" || !state.session) {
    toast(tr("Load real replay laps first.", "실제 리플레이 랩을 먼저 불러와주세요."));
    return;
  }
  if (state.contextLoading) return;
  state.contextLoading = true;
  const button = $("load-session-model");
  button.disabled = true;
  button.textContent = "LOADING…";
  $("analysis-status").textContent = "SESSION CONTEXT LOADING";
  const sessionKey = Number(state.session.session_key);
  try {
    if (force || Number(state.sessionContext?.sessionKey) !== sessionKey) {
      const stints = !force && state.stintsStatus === "loaded" && Number(state.stintsSessionKey) === sessionKey ? state.stints : await apiFetch("stints", { session_key: sessionKey });
      const [pits, raceControl, weather] = await Promise.all([
        optionalApiFetch("pit", { session_key: sessionKey }),
        optionalApiFetch("race_control", { session_key: sessionKey }),
        optionalApiFetch("weather", { session_key: sessionKey }),
      ]);
      if (Number(state.session?.session_key) !== sessionKey) return;
      Object.assign(state, { stints, stintsSessionKey: sessionKey, stintsStatus: "loaded" });
      state.sessionContext = { sessionKey, stints, pits, raceControl, weather, intervals: new Map(), intervalAvailability: new Map(), trackModel: null };
    }
    if (isRaceLikeSession()) {
      for (const driver of [Number(state.selectedA), Number(state.selectedB)]) {
        if (!state.sessionContext.intervals.has(driver)) {
          const intervals = await optionalApiFetch("intervals", { session_key: sessionKey, driver_number: driver });
          if (Number(state.session?.session_key) !== sessionKey) return;
          state.sessionContext.intervals.set(driver, intervals);
          state.sessionContext.intervalAvailability.set(driver, intervals.length > 0);
        }
      }
    }
    buildPaceRows();
    $("analysis-status").textContent = `${sessionTitle(state.session)} · PACE MODEL READY`;
    button.textContent = tr("RECALCULATE PACE & STRATEGY", "PACE & STRATEGY 다시 계산");
    updateLabDetails();
    toast(tr("Session context and descriptive pace model updated.", "세션 조건과 기술적 pace 모델을 갱신했습니다."));
  } catch (error) {
    $("analysis-status").textContent = "SESSION MODEL LOAD FAILED";
    toast(error.message);
  } finally {
    state.contextLoading = false;
    button.disabled = false;
    if (button.textContent === "LOADING…") button.textContent = tr("Load pace & strategy", "PACE & STRATEGY 불러오기");
    if(state.selectedMode==="replay"&&state.source==="openf1"&&state.session&&Number(state.session.session_key)!==sessionKey)loadSessionContext();
  }
}

function setAnalysisTab(name) {
  state.activeAnalysisTab = name;
  document.querySelectorAll("[data-analysis-tab]").forEach((button) => {
    const active = button.dataset.analysisTab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-analysis-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.analysisPanel !== name));
}

function clearDistancePointer() {
  if (typeof clearLinkedPointer === "function") clearLinkedPointer();
}

function renderTrack(domain) {
  const dataA = (state.locations.get(Number(state.selectedA)) || []).filter((sample) => sample.t >= domain.start && sample.t <= domain.end && Number.isFinite(sample.x)&&Number.isFinite(sample.y));
  const dataB = (state.locations.get(Number(state.selectedB)) || []).filter((sample) => sample.t >= domain.start && sample.t <= domain.end && Number.isFinite(sample.x)&&Number.isFinite(sample.y));
  const all = [...dataA, ...dataB].filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));
  if (all.length < 2) {
    $("track-empty").classList.remove("hidden");
    $("track-base").setAttribute("d", "");
    $("track-path-a").setAttribute("d", "");
    $("track-path-b").setAttribute("d", "");
    return;
  }
  $("track-empty").classList.add("hidden");
  const minX = Math.min(...all.map((point) => point.x));
  const maxX = Math.max(...all.map((point) => point.x));
  const minY = Math.min(...all.map((point) => point.y));
  const maxY = Math.max(...all.map((point) => point.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min(540 / spanX, 300 / spanY);
  const offsetX = (600 - spanX * scale) / 2;
  const offsetY = (350 - spanY * scale) / 2;
  const mapPoint = (point) => ({ x: offsetX + (point.x - minX) * scale, y: 350 - (offsetY + (point.y - minY) * scale) });
  const pathFor = (points) => points.map((point, index) => {
    const mapped = mapPoint(point);
    return `${index ? "L" : "M"}${mapped.x.toFixed(1)},${mapped.y.toFixed(1)}`;
  }).join(" ");
  const pathA = pathFor(dataA);
  const pathB = pathFor(dataB);
  $("track-path-a").setAttribute("d", pathA);
  $("track-path-b").setAttribute("d", pathB);
  $("track-base").setAttribute("d", dataA.length >= dataB.length ? pathA : pathB);
  const currentA = latestSample(dataA, domain.cursor);
  const currentB = latestSample(dataB, domain.cursor);
  [["a", currentA], ["b", currentB]].forEach(([prefix, point]) => {
    const marker = $(`car-marker-${prefix}`);
    if (point) {
      const mapped = mapPoint(point);
      marker.setAttribute("cx", mapped.x);
      marker.setAttribute("cy", mapped.y);
    } else {
      marker.setAttribute("cx", -20);
      marker.setAttribute("cy", -20);
    }
  });
}

function render() {
  if (typeof renderPlaybackControls === "function") renderPlaybackControls();
  if (typeof renderWorkspace === "function" && renderWorkspace()) return;
  updateNames();
  const domain = viewDomain();
  const samplesA = visibleSamples(state.selectedA, domain);
  const samplesB = visibleSamples(state.selectedB, domain);
  setPath("speed-a", samplesA, (sample) => sample.speed, domain, 360, 290);
  setPath("speed-b", samplesB, (sample) => sample.speed, domain, 360, 290);
  setPath("throttle-line-a", samplesA, (sample) => sample.throttle, domain, 100, 210);
  setPath("throttle-line-b", samplesB, (sample) => sample.throttle, domain, 100, 210);
  renderBrakeBands("brake-bands-a", samplesA, domain, 210, "a");
  renderBrakeBands("brake-bands-b", samplesB, domain, 210, "b");

  const cursorX = ((domain.cursor - domain.start) / Math.max(0.001, domain.end - domain.start)) * 1000;
  ["speed-cursor", "input-cursor"].forEach((id) => {
    $(id).setAttribute("x1", Math.max(0, Math.min(1000, cursorX)));
    $(id).setAttribute("x2", Math.max(0, Math.min(1000, cursorX)));
  });
  updateChartTooltip(domain, samplesA, samplesB);

  const currentA = latestSample(samplesA, domain.cursor);
  const currentB = latestSample(samplesB, domain.cursor);
  updateReadout("a", currentA);
  updateReadout("b", currentB);
  if (Number.isFinite(currentA?.speed) && Number.isFinite(currentB?.speed)) {
    const delta = currentA.speed - currentB.speed;
    $("speed-delta").textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}km/h`;
    $("speed-delta").style.color = delta >= 0 ? "var(--cyan)" : "var(--amber)";
  } else {
    $("speed-delta").textContent = "—km/h";
    $("speed-delta").style.color = "";
  }

  const statsA = rollingStats(samplesA);
  const statsB = rollingStats(samplesB);
  $("min-speed-a").textContent = statsA.min == null ? "—" : Math.round(statsA.min);
  $("min-speed-b").textContent = statsB.min == null ? "—" : Math.round(statsB.min);
  $("full-throttle-a").textContent = statsA.full == null ? "—" : statsA.full.toFixed(0);
  $("full-throttle-b").textContent = statsB.full == null ? "—" : statsB.full.toFixed(0);
  $("brake-events-a").textContent = statsA.brakes == null ? "—" : statsA.brakes;
  $("brake-events-b").textContent = statsB.brakes == null ? "—" : statsB.brakes;
  $("window-label").textContent = state.mode === "replay" ? `Full lap · ${state.replayDuration.toFixed(1)}s` : `${LIVE_WINDOW_SECONDS}s`;

  const duration = domain.end - domain.start;
  $("x-start").textContent = state.mode === "live" ? `−${duration.toFixed(0)}s` : "0.0s";
  $("x-mid").textContent = state.mode === "live" ? `−${(duration / 2).toFixed(0)}s` : `${(duration / 2).toFixed(1)}s`;
  $("x-end").textContent = state.mode === "live" ? "NOW" : `${duration.toFixed(1)}s`;

  const latest = currentA || currentB;
  if (state.mode === "live" && latest) {
    $("data-age").textContent = `${Math.max(0, Date.now() / 1000 - latest.t).toFixed(1)}s old`;
  } else if (state.mode === "replay") {
    $("data-age").textContent = `${domain.cursor.toFixed(1)}s`;
  } else {
    $("data-age").textContent = "--.- s old";
  }
  renderTrack(domain);
  renderEvents();
  if (typeof renderTimeWorkspace === "function") renderTimeWorkspace();
}

document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => { if (button.dataset.mode) setMode(button.dataset.mode); }));
$("connect-live").addEventListener("click", connectLive);
$("access-token").addEventListener("keydown", (event) => { if (event.key === "Enter") connectLive(); });
$("clear-events").addEventListener("click", () => { state.events = []; renderEvents(); });
$("replay-session").addEventListener("change", () => loadReplay({ skipCache: true, sessionKey: Number($("replay-session").value) }));
$("speed-chart").addEventListener("pointermove", (event) => handleChartPointerMove(event, "speed"));
$("speed-chart").addEventListener("pointerleave", () => handleChartPointerLeave("speed"));
$("input-chart").addEventListener("pointermove", (event) => handleChartPointerMove(event, "input"));
$("input-chart").addEventListener("pointerleave", () => handleChartPointerLeave("input"));
document.querySelectorAll("[data-analysis-tab]").forEach((button) => button.addEventListener("click", () => setAnalysisTab(button.dataset.analysisTab)));
$("load-session-model").addEventListener("click", () => loadSessionContext());
let strategyInputTimer=null,pendingLegacyStrategy=false;
function scheduleStrategyInputUpdate(includeLegacy=false){
  pendingLegacyStrategy=pendingLegacyStrategy||includeLegacy;
  clearTimeout(strategyInputTimer);
  strategyInputTimer=setTimeout(flushPendingStrategyInputUpdate,200);
}
function flushPendingStrategyInputUpdate(){
  if(strategyInputTimer===null)return;
  clearTimeout(strategyInputTimer);strategyInputTimer=null;
  const legacy=pendingLegacyStrategy;pendingLegacyStrategy=false;
  if(legacy){syncStrategyControls();if(state.sessionContext)buildPaceRows();else renderStrategyAnalysis();}
  if(typeof renderRaceReplay==='function')renderRaceReplay();
}
["strategy-horizon", "strategy-delay", "strategy-warmup", "strategy-fuel-gain", "strategy-pit-loss", "strategy-sc-factor", "strategy-vsc-factor"].forEach((id) => {
  $(id).addEventListener("input",()=>scheduleStrategyInputUpdate(true));
  $(id).addEventListener("change",()=>{scheduleStrategyInputUpdate(true);flushPendingStrategyInputUpdate();});
  $(id).addEventListener("blur",()=>{syncStrategyControls({commit:true});if(typeof syncRaceInputs==='function')syncRaceInputs({commit:true});scheduleStrategyInputUpdate(true);flushPendingStrategyInputUpdate();});
});

async function handleDriverChange() {
  if (state.selectedMode === "replay") {
    const driverA = Number($("driver-a").value);
    let driverB = Number($("driver-b").value);
    if (driverA === driverB) driverB = Number(state.drivers.find(driver => Number(driver.driver_number) !== driverA)?.driver_number);
    await loadReplay({ driverA, driverB });
    if (!state.replayError && state.sessionContext && state.selectedMode === "replay") await loadSessionContext();
    return;
  }
  state.selectedA = Number($("driver-a").value);
  state.selectedB = Number($("driver-b").value);
  if (state.selectedA === state.selectedB) {
    const alternative = state.drivers.find((driver) => Number(driver.driver_number) !== state.selectedA);
    if (alternative) {
      state.selectedB = Number(alternative.driver_number);
      $("driver-b").value = String(state.selectedB);
    }
  }
  updateNames();
  if (state.source === "demo") { applyDemoComparison(); return; }
  if (state.mode === "replay" && state.source === "openf1") {
    await loadReplay({ skipCache: true });
    if (state.sessionContext && Number(state.sessionContext.sessionKey) === Number(state.session?.session_key)) await loadSessionContext();
  }
  else render();
}

$("driver-a").addEventListener("change", handleDriverChange);
$("driver-b").addEventListener("change", handleDriverChange);

function telemetrySnapshot() {
  const domain = viewDomain();
  const progressMode=typeof linkedTraceActive==="function" && linkedTraceActive();
  const point=progressMode ? alignedPoint(clippedProgress(state.cursorProgress)) : null;
  const sampleA = progressMode ? alignedCursorSample("A",point) : latestSample(visibleSamples(state.selectedA, domain), domain.cursor);
  const sampleB = progressMode ? alignedCursorSample("B",point) : latestSample(visibleSamples(state.selectedB, domain), domain.cursor);
  const compact = (sample) => sample ? {
    speed_kmh: roundedOrNull(sample.speed),
    throttle_percent: roundedOrNull(sample.throttle),
    brake_on: Number.isFinite(sample.brake) ? sample.brake > 0 : null,
    gear: numberOrNull(sample.n_gear),
    rpm: roundedOrNull(sample.rpm),
    lap_relative_time_seconds: state.mode==="replay" ? sample.t : null,
  } : null;
  return {
    mode: state.mode,
    source: state.source,
    selected_mode: state.selectedMode,
    cursor: progressMode ? {axis:"estimated_progress",value:point.progress,window:[...state.progressWindow]} : {axis:state.mode==="replay"?"lap_seconds":"unix_seconds",value:domain.cursor},
    session: sessionTitle(state.session),
    driver_a: { number: state.selectedA, code: shortName(state.selectedA), sample: compact(sampleA) },
    driver_b: { number: state.selectedB, code: shortName(state.selectedB), sample: compact(sampleB) },
    distance_analysis: state.distanceAnalysis ? {
      finish_delta_a_minus_b_seconds: Number(state.distanceAnalysis.finishDelta.toFixed(3)),
      detected_speed_zones: state.distanceAnalysis.corners.length,
      axis: "A's approximate position path as a shared normalized reference; native lap timestamps retained",
    } : null,
    interpretation_limit: "Brake is binary, position is approximate, and the distance axis is normalized progress rather than FIA official circuit distance.",
  };
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const register = (tool) => {
    try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) { /* optional browser capability */ }
  };
  register({
    name: "read_telemetry_snapshot",
    title: "Read telemetry snapshot",
    description: "Read the currently displayed F1 telemetry mode, session, selected drivers, and current public telemetry values without changing the dashboard.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() { return telemetrySnapshot(); },
  });
  register({
    name: "select_driver_comparison",
    title: "Select driver comparison",
    description: "Select two distinct driver numbers already available in the dashboard and update the visible telemetry comparison.",
    inputSchema: {
      type: "object",
      properties: {
        driverA: { type: "integer", description: "Driver number for trace A" },
        driverB: { type: "integer", description: "Driver number for trace B" },
      },
      required: ["driverA", "driverB"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      const driverA = Number(input?.driverA);
      const driverB = Number(input?.driverB);
      const available = new Set(state.drivers.map((driver) => Number(driver.driver_number)));
      if (!Number.isInteger(driverA) || !Number.isInteger(driverB) || driverA === driverB) throw new Error("Choose two distinct integer driver numbers.");
      if (!available.has(driverA) || !available.has(driverB)) throw new Error("One or both driver numbers are not available in the current session.");
      $("driver-a").value = String(driverA);
      $("driver-b").value = String(driverB);
      await handleDriverChange();
      return { driver_a: shortName(state.selectedA), driver_b: shortName(state.selectedB), mode: state.mode };
    },
  });
  register({
    name: "read_performance_analysis",
    title: "Read performance analysis",
    description: "Read approximate distance delta, detected speed zones, descriptive stint pace-age slopes and scenario assumptions. These are not validated corner, tyre-state or race-strategy predictions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      return {
        session: sessionTitle(state.session),
        drivers: [shortName(state.selectedA), shortName(state.selectedB)],
        distance: state.distanceAnalysis ? {
          finish_delta_a_minus_b_seconds: Number(state.distanceAnalysis.finishDelta.toFixed(3)),
          detected_speed_zones: state.distanceAnalysis.corners.length,
        } : null,
        stints: state.paceRows.map((row) => ({
          driver: shortName(row.driver),
          stint: row.stintNumber,
          compound: row.compound,
          usable_laps: row.usable,
          fit_laps: row.fitLaps,
          base_pace_seconds: row.basePace,
          current_tyre_age: row.currentAge,
          descriptive_pace_age_slope_seconds_per_lap: Number.isFinite(row.degradation) ? Number(row.degradation.toFixed(4)) : null,
          fit_r_squared: Number.isFinite(row.r2) ? Number(row.r2.toFixed(3)) : null,
          fit_status: row.fitStatus,
        })),
        strategy_assumptions: strategyInputs(),
        race_scenario: typeof raceExportPayload === "function" ? raceExportPayload() : null,
        prediction_validation: { scope: "Historical regression versus recent-lap mean; conditional replacement checks, not calibrated race outcomes", report: "./data/prediction-validation.json" },
      };
    },
  });
}

setInterval(() => { $("session-clock").textContent = kstClock(); }, 1000);
$("session-clock").textContent = kstClock();
registerWebMcpTools();
