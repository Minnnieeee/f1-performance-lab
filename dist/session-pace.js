"use strict";
let preparedSessionPace=null,sessionPaceKey=null;
function renderSessionPace(){
  const node=$('session-pace-result');if(!node)return;
  const c=state.sessionContext,s=state.session;
  if(state.mode!=='replay'||!s){node.textContent='Choose a historical session in Replay.';return;}
  if(!c||Number(c.sessionKey)!==Number(s.session_key)){node.textContent=state.contextLoading?'Loading timing context…':'Timing context is unavailable. Use Load pace & strategy to retry.';return;}
  if(sessionPaceKey!==c||preparedSessionPace?.data.laps!==state.laps){
    preparedSessionPace=PaceEngine.prepare({session:s,laps:state.laps,stints:c.stints,pits:c.pits,raceControl:c.raceControl});sessionPaceKey=c;
  }
  const fuel=Number($('pace-fuel').value);if(!Number.isFinite(fuel)||fuel<0||fuel>.15){node.textContent='Fuel gain must be between 0 and 0.15s/lap.';return;}
  const rows=[];
  for(const [side,id] of [['a',state.selectedA],['b',state.selectedB]]){
    const select=$('pace-origin-'+side),laps=(preparedSessionPace.byDriver.get(Number(id))||[]).filter(l=>Number.isFinite(RaceEngine.end(l)));
    const key=`${s.session_key}:${id}:${laps.length}`;
    if(select.dataset.key!==key){select.innerHTML=laps.map(l=>`<option value="${l.lap_number}">L${l.lap_number} · ${l.lap_duration.toFixed(3)}s</option>`).join('');select.dataset.key=key;const chosen=state.replayData.get(Number(id))?.lap?.lap_number;const canForecast=l=>PaceEngine.forecast(preparedSessionPace,id,l.lap_number).recent[0]?.value!=null;const preferred=laps.find(l=>l.lap_number===chosen&&canForecast(l))||laps.slice().reverse().find(canForecast)||laps.filter(l=>!preparedSessionPace.reason(l)&&preparedSessionPace.stateAt(RaceEngine.end(l))!=='FINISHED').at(-1)||laps.at(-1);select.value=String(preferred?.lap_number||'');}
    const offset=Number($('pace-offset-'+side).value);
    if(!Number.isFinite(offset)||Math.abs(offset)>5){node.textContent='Assumed pace changes must be between −5 and +5s/lap.';return;}
    const f=PaceEngine.forecast(preparedSessionPace,id,Number(select.value),{fuelGain:fuel,offset});
    const driver=state.drivers.find(d=>Number(d.driver_number)===Number(id)),name=driver?.name_acronym||driver?.last_name||'#'+id;
    const reasons={incomplete_sector_timing:'Sector timing is incomplete; the lap may include a pit/garage interval',inconsistent_sector_timing:'Reported lap time disagrees with the sector sum',missing_or_invalid_timing:'Lap timing is invalid',missing_origin:'No completed origin lap',missing_stint:'Tyre stint is not reported',no_usable_prior_lap:'No usable completed lap in this stint',stale_run:'Last usable lap is more than three laps behind',pit_entry_at_origin:'This lap ends in a pit stop',pit_or_outlap:'Choose a timed lap outside the pit entry/outlap',affected_track_status:'This lap is interrupted or the session has ended',unknown_track_status:'Track status is not known at this lap',local_yellow:'A yellow flag affects this lap',missing_tyre_age:'Tyre age is unknown',fewer_than_three_fit_laps:'Fewer than three usable fit laps',negative_trend_extrapolation:'Negative trend outside observed ages',age_support:'Outside observed age support'};
    const fmt=n=>n==null?'—':n.toFixed(3)+'s';
    if(f.reason){rows.push(`<article><h4>${esc(name)} · L${select.value||'—'}</h4><p>${esc(f.reason==='session_finished'?'The session or qualifying phase has ended. Choose an earlier lap.':reasons[f.reason]||f.reason)}</p></article>`);continue;}
    if(f.n<3){rows.push(`<article><h4>${esc(name)} · after L${f.origin} · ${esc(f.compound||'unknown tyre')}</h4><p>Observed reference: <b>${fmt(f.reference)}</b> from ${f.used.map(n=>'L'+n).join(', ')}.</p><p>Only ${f.n} usable lap${f.n===1?'':'s'} in this stint. Three are needed for a forecast; the reference above is not a predicted next lap.</p></article>`);continue;}
    rows.push(`<article><h4>${esc(name)} · after L${f.origin} · ${esc(f.compound||'unknown tyre')}</h4><p>Recent pace from ${f.n} lap${f.n===1?'':'s'}: ${f.used.map(n=>'L'+n).join(', ')}${f.n===1?' · single-lap reference':''}. Assumed change ${offset>=0?'+':''}${offset.toFixed(2)}s/lap.</p><div class="table-scroll"><table class="analysis-table"><thead><tr><th>Target</th><th>Recent pace</th><th>Pace-age trend</th></tr></thead><tbody>${f.recent.map((r,i)=>`<tr><td>L${f.origin+r.h}</td><td>${fmt(r.value)}</td><td>${fmt(f.trend[i].value)}</td></tr>`).join('')}</tbody></table></div><p class="engineering-note">${f.trend[0].reason?`Trend unavailable: ${esc(reasons[f.trend[0].reason]||f.trend[0].reason)}. Recent pace is still available.`:`Trend uses ${f.model.n} laps; fuel gain ${fuel.toFixed(3)}s/lap. Changing fuel does not change the raw recent-lap reference.`}</p></article>`);
  }
  node.innerHTML=rows.join('');
}
for(const id of ['pace-origin-a','pace-origin-b'])$(id).addEventListener('change',renderSessionPace);
let paceInputTimer;for(const id of ['pace-offset-a','pace-offset-b','pace-fuel'])$(id).addEventListener('input',()=>{clearTimeout(paceInputTimer);paceInputTimer=setTimeout(renderSessionPace,180);});
renderSessionPace();
