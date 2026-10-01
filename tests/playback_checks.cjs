"use strict";
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = name => fs.readFileSync(require.resolve('../dist/' + name), 'utf8');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {value:'',textContent:'',style:{},attrs:{},handlers:{},
    classList:{add(){},remove(){},toggle(){}}, setAttribute(k,v){this.attrs[k]=v;},
    addEventListener(k,v){this.handlers[k]=v;}, closest(){return this;}});
  return elements.get(id);
}
let wall = 0;
const document = {hidden:false,getElementById:element,addEventListener(){},querySelectorAll(){return[];}};
const ctx = vm.createContext({console,document,performance:{now:()=>wall},setTimeout,clearTimeout,
  demo:require('../dist/data/demo.json')});
const run = code => vm.runInContext(code,ctx);
const app = source('app.js'), workspace = source('workspace.js');
run(app.slice(0,app.indexOf('document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener')));
run(source('playback.js'));
run(workspace.slice(0,workspace.lastIndexOf('setupWorkspace();')));
run(`render=()=>{}; renderDistancePerformanceAnalysis=()=>{};
  state.selectedA=4;state.selectedB=81;state.session=demo.session;
  state.replayData=new Map([4,81].map(id=>[id,demo.datasets.find(d=>d.lap.driver_number===id&&d.lap.lap_number===25)]));
  state.replayDuration=87.092;workspaceReady=true;state.traceAxis='progress';
  buildDistancePerformanceAnalysis();resetPlaybackClock();`);
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const step = ms => {wall+=ms;run(`advanceReplayClock(${wall})`);};
const start=run('state.replayCursor');step(1000);close(run('state.replayCursor'),start+1);
run('setPlaybackTime(20)');
close(run('alignedPoint(state.cursorProgress).tA'),20);
const checkReadouts = () => {
  run('var point=alignedPoint(state.cursorProgress);drawLinkedMap(point);updateReadout("a",alignedCursorSample("A",point));updateReadout("b",alignedCursorSample("B",point));');
  for(const side of ['A','B']) {
    const expected=run(`alignedCursorSample('${side}',point).rpm`);
    assert.equal(element('rpm-'+side.toLowerCase()).textContent,Math.round(expected).toLocaleString('en-US'));
    assert.ok(Number.isFinite(element('car-marker-'+side.toLowerCase()).attrs.cx));
  }
};
checkReadouts();const rpm=element('rpm-a').textContent,x=element('car-marker-a').attrs.cx;
step(5000);checkReadouts();assert.notEqual(element('rpm-a').textContent,rpm);assert.notEqual(element('car-marker-a').attrs.cx,x);
element('playback-toggle').handlers.click();const paused=run('state.replayCursor');step(3000);close(run('state.replayCursor'),paused);
element('playback-toggle').handlers.click();element('playback-speed').handlers.change({target:{value:'2'}});step(1000);close(run('state.replayCursor'),paused+2);
run('state.cursorProgress=.4;syncPlaybackToInspection();state.tracePointer={name:"speed"};');const inspected=run('state.replayCursor');step(2000);close(run('state.replayCursor'),inspected);
run('state.tracePointer=null');step(1000);close(run('state.replayCursor'),inspected+2);
element('playback-seek').handlers.input({target:{value:'500'}});assert.equal(run('playback.playing'),false);
const sought=run('state.replayCursor');step(1000);close(run('state.replayCursor'),sought);
run('setProgressWindow(.2,.3);resetPlaybackClock();playback.speed=1;');const bounds=run('playbackBounds()');step((bounds[1]-bounds[0]+.5)*1000);close(run('state.replayCursor'),bounds[0]+.5);
document.hidden=true;const hidden=run('state.replayCursor');step(5000);close(run('state.replayCursor'),hidden);document.hidden=false;
run('state.replayLoading=true');step(3000);close(run('state.replayCursor'),hidden);run('state.replayLoading=false');
run('state.traceAxis="time";resetPlaybackClock()');step(1000);close(run('state.replayCursor'),1);
run('state.mode="live"');step(1000);close(run('state.replayCursor'),1);
run('state.mode="replay";state.traceAxis="progress";state.progressWindow=[0,1];resetPlaybackClock();setPlaybackTime(20);');
run('state.distanceAnalysis.lapA.telemetry=[]');assert.equal(run('alignedCursorSample("A",alignedPoint(state.cursorProgress))'),null);
console.log('Playback passed: recorded-time progression, matched RPM/map, pause/resume, speed, inspection, seeking, zoom loop, hidden/loading/live and missing telemetry.');
