"use strict";

// One clock drives the trace cursor, position markers and telemetry readouts.
// Progress comparison uses A's recorded time; B is sampled at the same progress.
const playback = { playing: true, speed: 1, lastWall: null };

function playbackUsesProgress() {
  return typeof linkedTraceActive === "function" && linkedTraceActive();
}

function playbackBounds() {
  if (playbackUsesProgress()) {
    const path = state.distanceAnalysis.lapA.path;
    return state.progressWindow.map(p => interpolateField(path, p, "progress", "t"));
  }
  return [0, state.replayDuration];
}

function setPlaybackTime(seconds) {
  const [start, end] = playbackBounds();
  if (!Number.isFinite(seconds) || !Number.isFinite(start) || !Number.isFinite(end)) return;
  state.replayCursor = Math.max(start, Math.min(end, seconds));
  if (state.distanceAnalysis) {
    const path = state.distanceAnalysis.lapA.path;
    state.cursorProgress = clippedProgress(interpolateField(path, state.replayCursor, "t", "progress"));
  }
}

function syncPlaybackToInspection() {
  if (playbackUsesProgress()) {
    // This is clock positioning, not a claim of data support across missing samples.
    state.replayCursor = interpolateField(state.distanceAnalysis.lapA.path, state.cursorProgress, "progress", "t");
  } else if (Number.isFinite(state.hoverTime)) state.replayCursor = state.hoverTime;
  playback.lastWall = performance.now();
}

function advanceReplayClock(now) {
  const elapsed = playback.lastWall === null ? 0 : Math.max(0, (now - playback.lastWall) / 1000);
  playback.lastWall = now;
  if (state.mode !== "replay" || state.replayLoading || document.hidden) return;
  if (state.tracePointer || state.traceDrag || Number.isFinite(state.hoverTime)) return;
  if (!playback.playing) return;
  const [start, end] = playbackBounds(), duration = end - start;
  if (!(duration > 0)) return;
  const cursor = Math.max(start, Math.min(end, state.replayCursor));
  setPlaybackTime(start + (cursor - start + elapsed * playback.speed) % duration);
}

function resetPlaybackClock() {
  playback.playing = true;
  playback.lastWall = performance.now();
  state.tracePointer = null;
  state.traceDrag = null;
  clearChartHover();
  setPlaybackTime(playbackBounds()[0]);
}

function renderPlaybackControls() {
  const controls = $("playback-controls");
  if (!controls) return;
  const ready = state.mode === "replay" && state.replayDuration > 0;
  controls.classList.toggle("hidden", !ready);
  if (!ready) return;
  const inspecting = !!(state.tracePointer || state.traceDrag || Number.isFinite(state.hoverTime));
  $("playback-toggle").textContent = playback.playing ? "PAUSE" : "PLAY";
  $("playback-toggle").setAttribute("aria-label", playback.playing ? "Pause lap playback" : "Play lap playback");
  $("playback-state").textContent = state.replayLoading ? "LOADING" : inspecting ? "INSPECTING" : playback.playing ? "PLAYING · LOOP" : "PAUSED";
  const [start, end] = playbackBounds();
  const time = !playbackUsesProgress() && Number.isFinite(state.hoverTime) ? state.hoverTime : state.replayCursor;
  $("playback-seek").value = end > start ? String((time - start) / (end - start) * 1000) : "0";
  $("playback-seek").setAttribute("aria-valuetext", `${time.toFixed(1)} seconds${playbackUsesProgress() ? ", driver A reference" : " into lap"}`);
  $("playback-clock").textContent = `${time.toFixed(1)}s / ${end.toFixed(1)}s`;
  $("playback-note").textContent = playbackUsesProgress()
    ? "A's lap clock drives both cars at matched progress. Hover a trace to inspect; leave to continue."
    : "Both cars follow the same lap elapsed time. Hover a trace to inspect; leave to continue.";
}

$("playback-toggle").addEventListener("click", () => {
  syncPlaybackToInspection();
  playback.playing = !playback.playing;
  state.tracePointer = null;
  clearChartHover();
  render();
});
$("playback-restart").addEventListener("click", () => { resetPlaybackClock(); render(); });
$("playback-speed").addEventListener("change", event => {
  playback.speed = Number(event.target.value);
  playback.lastWall = performance.now();
});
$("playback-seek").addEventListener("input", event => {
  playback.playing = false;
  state.tracePointer = null;
  clearChartHover();
  const [start, end] = playbackBounds();
  setPlaybackTime(start + Number(event.target.value) / 1000 * (end - start));
  playback.lastWall = performance.now();
  render();
});
document.addEventListener("visibilitychange", () => { playback.lastWall = performance.now(); });
