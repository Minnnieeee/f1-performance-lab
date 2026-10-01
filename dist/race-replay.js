"use strict";
// UI adapter for the pure historical engine. Existing LIVE path is untouched.
let frozenRace=null,frozenRaceFailed=false;
const cutoffAvailability={key:null,generation:0,cache:new Map(),raw:null};
const frozenRaceCases=new Map();
// Strategy examples are independent of the telemetry viewer's mode/session.
let raceSource="9213",raceCaseRequest=0;
const raceCaseFiles={"9213":"race-austin.json","9189":"race-demo.json","9157":"race-monza.json","9165":"race-singapore.json"};
const raceDemoActive=()=>raceSource!=="current"&&!!frozenRace;
const raceSession=()=>raceDemoActive()?frozenRace.session:state.session;
const raceDriver=side=>raceDemoActive()?frozenRace[side==="a"?"driverA":"driverB"]:Number(state[side==="a"?"selectedA":"selectedB"]);
const raceLaps=()=>raceDemoActive()?frozenRace.laps:state.laps;
const raceName=d=>raceDemoActive()?(frozenRace.drivers.find(r=>Number(r.driver_number)===Number(d))?.name_acronym||String(d)):shortName(d);
const raceReplay={key:null,raw:null,snapshot:null,result:null,loading:false,error:null,request:0,cache:new Map(),selectionKey:null,cutoff:null};
function raceSessionAllowed(){return raceDemoActive()||raceSource==="current"&&state.mode==="replay"&&state.selectedMode==="replay"&&state.source==="openf1"&&isRaceLikeSession();}
function raceRequestKey(){return `${raceSession()?.session_key}:${raceDriver("a")}:${raceDriver("b")}:${$("race-cutoff").value}`;}
function raceInputs(){
  const base=strategyInputs();
  const read=(id,fallback,min,max,integer=false)=>{const v=numberOrNull($(id).value),n=v===null?fallback:Math.min(max,Math.max(min,v));return integer?Math.round(n):n;};
  return {...base,maxExtrapolation:read("race-max-extrapolation",5,0,20,true),warmupA:base.warmup,warmupB:read("race-warmup-b",.6,0,5),compoundA:$("race-compound-a").value,compoundB:$("race-compound-b").value,condition:$("race-control").value,neutralLaps:read("race-neutral-laps",2,1,base.horizon,true),paceRange:read("race-pace-range",.3,0,3),pitRange:read("race-pit-range",2,0,10),trafficA:read("race-traffic-a",0,0,5),trafficB:read("race-traffic-b",0,0,5),trafficLaps:read("race-traffic-laps",1,0,10,true)};
}
function syncRaceInputs({commit=false}={}){
  const values=raceInputs(),keys={"race-max-extrapolation":"maxExtrapolation","race-neutral-laps":"neutralLaps","race-pace-range":"paceRange","race-pit-range":"pitRange","race-traffic-a":"trafficA","race-traffic-b":"trafficB","race-traffic-laps":"trafficLaps","race-warmup-b":"warmupB"};
  $("race-neutral-laps").max=values.horizon;
  Object.entries(keys).forEach(([id,key])=>{
    const input=$(id),resolved=resolveInput(input.value,Number(input.min),Number(input.max),Number(input.defaultValue),input.step==="1");
    const note=$(id+"-effective");if(note){note.textContent=resolved.note||"";input.closest("label").classList.toggle("adj",!!resolved.note);}
    if(commit)input.value=String(values[key]);
  });
  return values;
}
function raceCopy(){
  $("race-horizon-help").textContent=tr("Evaluation endpoint · 3–30 laps. Changing H changes the question.","평가 종료 시점 · 3–30랩. 바꾸면 질문 자체가 바뀝니다.");
  $("race-delay-help").textContent=tr("Stop schedule · 1 to H−1. B waits in A-first; A waits in A-later.","정차 일정 · 1~H−1. A 선행에서는 B가, A 후행에서는 A가 기다리는 행동 가정입니다.");
  $("strategy-fuel-gain").closest("label").querySelector("small").textContent=tr("s/lap · 0–0.15. Added one-for-one to the pace-age slope.","s/lap · 0–0.15. 페이스–나이 기울기에 1:1로 더해집니다.");
  const headings={"race-data-label":["Saved example or current replay","저장된 예시 또는 현재 리플레이"],"race-primary-title":["Evaluation, stop schedule & fuel","평가 시점·정차 일정·연료"],"race-assumptions-title":["Assumptions","가정"],"race-evidence-title":["Evidence","근거"],"race-scan-title":["Pit timing scan","피트 시점 스캔"],"race-rejoin-title":["Rejoin","재합류"],"race-methods-title":["Methods & limits","방법 · 한계"]};
  Object.entries(headings).forEach(([id,pair])=>$(id).textContent=tr(...pair));
  $("race-selection-help").textContent=tr("Choose a race example, or select Current replay after loading a completed Race or Sprint above.","레이스 사례는 랩 비교 화면과 독립적입니다. 사례를 선택하면 A 선행·A 후행·동시 정차를 비교합니다. 다른 레이스는 REPLAY에서 연도와 완료된 Race/Sprint를 불러온 뒤 여기서 현재 리플레이를 선택하세요.");
  const fieldCopy={"strategy-horizon":["Horizon · H","평가 종료 · H"],"strategy-delay":["Delay · d","정차 지연 · d"],"strategy-fuel-gain":["Fuel gain","연료 이득"],"strategy-warmup":["A · warm-up penalty","A · 워밍업 손실"],"race-warmup-b":["B · warm-up penalty","B · 워밍업 손실"],"strategy-pit-loss":["Green pit loss","GREEN 피트 손실"],"strategy-sc-factor":["SC loss factor","SC 손실 배율"],"strategy-vsc-factor":["VSC loss factor","VSC 손실 배율"]};
  Object.entries(fieldCopy).forEach(([id,pair])=>$(id).closest("label").querySelector("span").textContent=tr(...pair));
  const helpCopy={"race-max-extrapolation":["Laps outside observed ages · not a tyre limit","관측 나이 밖 허용 랩 · 타이어 수명 한계 아님"],"race-neutral-laps":["Future laps · assumed","향후 랩 수 · 가정"],"race-pace-range":["± s/lap · not confidence","± s/lap · 신뢰구간 아님"],"race-pit-range":["± s · not confidence","± s · 신뢰구간 아님"],"race-traffic-a":["s/lap · assumed","s/lap · 가정"],"race-traffic-b":["s/lap · assumed","s/lap · 가정"],"race-traffic-laps":["Laps after the stop","정차 후 적용 랩"],"strategy-warmup":["s · assumed","s · 가정"],"race-warmup-b":["s · assumed","s · 가정"],"strategy-pit-loss":["s · assumed","s · 가정"],"strategy-sc-factor":["× green pit loss","× GREEN 피트 손실"],"strategy-vsc-factor":["× green pit loss","× GREEN 피트 손실"]};
  Object.entries(helpCopy).forEach(([id,pair])=>$(id).closest("label").querySelector("small").textContent=tr(...pair));
  const labels={"race-title":["Pit timing comparison","피트 시점 비교"],"race-extrapolation-label":["Age extrapolation allowance · assumed","나이 외삽 허용 랩 · 가정"],"race-cutoff-label":["Decision point: end of driver A lap","판단 시점 · A의 랩 종료"],"race-load":["Load race snapshot","레이스 시점 불러오기"],"race-export":["Export scenario JSON","시나리오 JSON 저장"],"race-compound-a-label":["A · replacement compound","A · 교체할 타이어"],"race-compound-b-label":["B · replacement compound","B · 교체할 타이어"],"race-control-label":["Track condition","트랙 상태"],"race-neutral-label":["SC/VSC duration · assumed","SC/VSC 지속 · 가정"],"race-pace-range-label":["Relative pace range · assumed","상대 페이스 변동 · 가정"],"race-pit-range-label":["Relative pit-loss range · assumed","상대 피트 손실 변동 · 가정"],"race-traffic-a-label":["A · post-stop traffic cost","A · 피트 후 교통 손실"],"race-traffic-b-label":["B · post-stop traffic cost","B · 피트 후 교통 손실"],"race-traffic-laps-label":["Traffic duration · assumed","교통 손실 지속 · 가정"],"race-legacy-label":["Full-session benchmark · not restricted to the decision point","전체 세션 단순 비교 · 선택 시점 이후 데이터도 포함"]};
  Object.entries(labels).forEach(([id,pair])=>{if($(id))$(id).textContent=tr(...pair);});
  $("race-control").options[0].textContent=tr("From recorded status","기록된 상태 사용");
  [1,2,3].forEach(i=>{$("race-control").options[i].textContent=["","GREEN","SC","VSC"][i]+tr(" · assumed"," · 가정");});
  $("race-intro").textContent=raceDemoActive()?tr("FROZEN RACE DEMO · separate from the Silverstone qualifying traces above. Change the decision lap and assumptions without OpenF1 requests.","동결 레이스 DEMO · 위 Silverstone 예선 트레이스와 별도 사례입니다. API 요청 없이 판단 랩과 가정을 바꿀 수 있습니다."):tr("Historical Race/Sprint only. The decision clock is separate from the lap-comparison cursor. Completed laps and events after this point are excluded from the model. No LIVE connection.","과거 Race/Sprint 전용입니다. 판단 시계는 위의 랩 비교 커서와 별개입니다. 선택 시점 이후 완료 랩·이벤트는 모델에서 제외하며 LIVE 연결은 사용하지 않습니다.");
}
function renderRaceReplay(){
  if(!$("race-replay"))return;
  raceCopy();
  $("race-demo-case").hidden=false;
  $("race-demo-case").value=raceSource;
  const currentOption=$("race-demo-case").querySelector('[value="current"]');
  currentOption.disabled=!(state.selectedMode==="replay"&&state.source==="openf1"&&isRaceLikeSession());
  currentOption.textContent=currentOption.disabled?tr("Current replay · load a Race/Sprint above first","현재 리플레이 · 위에서 Race/Sprint를 먼저 불러오세요"):tr("Current replay · ","현재 리플레이 · ")+sessionTitle(state.session);
  syncStrategyControls();syncRaceInputs();
  const selectionKey=`${raceSession()?.session_key}:${raceDriver("a")}:${raceDriver("b")}`;
  if(selectionKey!==raceReplay.selectionKey){cutoffAvailability.generation++;cutoffAvailability.key=null;raceReplay.selectionKey=selectionKey;raceReplay.key=null;raceReplay.result=null;raceReplay.error=null;raceReplay.request++;raceReplay.loading=false;}
  const available=raceSessionAllowed();
  const laps=available?raceLaps().filter(l=>Number(l.driver_number)===raceDriver("a")&&Number.isFinite(RaceEngine.end(l))).sort((a,b)=>Number(a.lap_number)-Number(b.lap_number)):[];
  const signature=laps.map(l=>l.lap_number).join(",");
  if($("race-cutoff").dataset.signature!==`${selectionKey}:${signature}`){
    const old=$("race-cutoff").value;$("race-cutoff").innerHTML=laps.map(l=>`<option value="${Number(l.lap_number)}">${esc(raceName(raceDriver("a")))} · L${Number(l.lap_number)}</option>`).join("");
    $("race-cutoff").dataset.signature=`${selectionKey}:${signature}`;
    $("race-cutoff").value=laps.some(l=>String(l.lap_number)===old)?old:String(raceDemoActive()?(frozenRace.decisionLap||45): (laps[Math.min(laps.length-1,Math.floor(laps.length/2))]?.lap_number??""));
  }
  $("race-load").disabled=!available||!laps.length||raceReplay.loading||(!raceDemoActive()&&(state.replayLoading||state.contextLoading));
  $("race-cutoff").disabled=!available||raceReplay.loading;
  if(raceDemoActive()&&raceReplay.key===null&&!raceReplay.error){raceReplay.raw=frozenRace;raceReplay.cutoff=RaceEngine.end(laps.find(l=>String(l.lap_number)===$("race-cutoff").value));raceReplay.key=raceRequestKey();}
  const current=available&&raceReplay.key===raceRequestKey()&&raceReplay.raw;
  $("race-export").disabled=!current||raceReplay.loading;
  if(!current){
    cutoffAvailability.generation++;cutoffAvailability.key=null;$("race-availability-status").textContent="";
    raceReplay.result=null;
    $("race-condition").textContent=available?"NO SNAPSHOT":raceSource!=="current"?(frozenRaceFailed?"EXAMPLE UNAVAILABLE":"LOADING EXAMPLE"):"RACE REPLAY ONLY";
    $("race-status").textContent=raceReplay.loading?tr("Loading one historical decision point…","선택한 과거 시점을 불러오는 중…"):raceReplay.error||(state.selectedMode==="demo"&&!frozenRace?tr(frozenRaceFailed?"Frozen race unavailable. Reload to retry.":"Loading bundled race examples…",frozenRaceFailed?"동결 예제 로딩 실패 · 새로고침으로 재시도하세요.":"동결 레이스 예제를 불러오는 중…"):tr(available?"Select a lap, then load the snapshot. Changing inputs afterwards requires no new requests.":"Select a completed Race or Sprint in REPLAY. The bundled qualifying DEMO cannot identify race tyre performance.",available?"랩을 선택하고 시점을 불러오세요. 이후 가정 변경은 추가 요청 없이 계산됩니다.":"REPLAY에서 완료된 Race 또는 Sprint를 선택하세요. 기본 예선 DEMO로 레이스 타이어 성능을 추정하지 않습니다."));
    if(raceSource!=="current")$("race-status").textContent=frozenRaceFailed?tr("This example could not load. Press RETRY EXAMPLE or choose another race.","사례를 불러오지 못했습니다. 사례 다시 불러오기를 누르거나 다른 레이스를 선택하세요."):tr("Loading the selected race and calculating scenarios…","선택한 레이스를 불러오고 시나리오를 계산하는 중…");
    $("race-load").disabled=raceSource!=="current"?!frozenRaceFailed:$("race-load").disabled;
    if(frozenRaceFailed)$("race-load").textContent=tr("RETRY EXAMPLE","사례 다시 불러오기");
    $("race-results").hidden=true;$("race-quick-result").hidden=false;$("race-observed-summary").textContent="";$("race-quick-result").textContent=$("race-status").textContent;return;
  }
  let inputs=raceInputs();
  const snap=RaceEngine.snapshot(raceReplay.raw,raceReplay.cutoff,inputs.fuelGain,inputs.maxExtrapolation);raceReplay.snapshot=snap;
  for(const side of ["a","b"]){
    const row=snap.rows.find(r=>r.driver===raceDriver(side));
    const compounds=[...new Set([row?.compound,...(row?.models||[]).map(m=>m.compound)].filter(Boolean))];
    const select=$("race-compound-"+side),old=select.value;
    select.innerHTML=compounds.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    select.value=compounds.includes(old)?old:row?.compound||"";
    $("race-compound-"+side+"-help").textContent=compounds.length>1?tr("Uses this driver's observed stint fit for each compound.","컴파운드별로 이 드라이버의 관측 스틴트 모델을 사용합니다."):tr("Only this compound has records before this decision. Other tyre performance is unknown.","이 시점 이전에는 이 컴파운드의 기록만 있습니다. 다른 타이어의 성능은 미확인입니다.");
  }
  inputs=raceInputs();const result=RaceEngine.evaluate(snap,raceDriver("a"),raceDriver("b"),inputs);raceReplay.result=result;
  $("race-results").hidden=false;$("race-quick-result").hidden=true;
  $("race-observed-summary").textContent=[result.a,result.b].filter(Boolean).map(row=>`${raceName(row.driver)} · ${row.compound||"—"} · ${row.age??"—"} ${tr("completed tyre laps","타이어 완료 랩")} · ${tr("last lap","직전 랩")} ${raceValue(row.lastLapTime,3)}s`).join(" | ")+` · ${tr("Assumed pit loss","가정 피트 손실")}: GREEN ${raceValue(result.savings.green)} / SC ${raceValue(result.savings.SC)} / VSC ${raceValue(result.savings.VSC)}s`;
  $("race-condition").textContent=`${result.condition} · ${result.condition==="GREEN_INFERRED"?tr("INFERRED FROM RECORDS","기록으로 추정"):result.conditionSource==="recorded"?tr("RECORDED","기록"):tr("ASSUMED","가정")}`;
  const last=snap.control.last;
  $("race-status").textContent=`${sessionTitle(raceSession())} · ${raceName(raceDriver("a"))} / ${raceName(raceDriver("b"))} · ${snap.cutoffISO} · ${snap.completedLaps} ${tr("completed driver-laps available","개 완료 드라이버 랩")} · ${tr("Recorded control","기록상 상태")}: ${snap.control.status}${last?` · ${last.date} · ${last.message||last.flag}`:""}${raceReplay.error?` · ${raceReplay.error}`:""}`;
  renderRaceResults(snap,result);
  scheduleCutoffAvailability(laps,inputs);
}
async function loadRaceSnapshot(){
  if(raceSource!=="current"&&!frozenRace){await selectRaceExample(raceSource);return;}
  if(!raceSessionAllowed()||raceReplay.loading)return;
  const cutoffLap=raceLaps().find(l=>Number(l.driver_number)===raceDriver("a")&&String(l.lap_number)===$("race-cutoff").value);
  if(!cutoffLap)return;
  if(raceDemoActive()){raceReplay.raw=frozenRace;raceReplay.cutoff=RaceEngine.end(cutoffLap);raceReplay.key=raceRequestKey();raceReplay.error=null;renderRaceReplay();return;}
  const cutoff=RaceEngine.end(cutoffLap),key=raceRequestKey(),sessionKey=state.session.session_key,generation=state.generation;
  const cacheKey=`${sessionKey}:${cutoff}`;
  raceReplay.loading=true;raceReplay.error=null;raceReplay.key=null;const request=++raceReplay.request;renderRaceReplay();
  try{
    if(!state.sessionContext||Number(state.sessionContext.sessionKey)!==Number(sessionKey))await loadSessionContext();
    if(!state.sessionContext||Number(state.sessionContext.sessionKey)!==Number(sessionKey))throw Error(tr("Session context could not be loaded.","세션 조건 데이터를 불러오지 못했습니다."));
    let extra=raceReplay.cache.get(cacheKey);
    if(!extra){
      // No all-season or full-grid telemetry download. Positions are event changes;
      // high-rate intervals are restricted to the 20 seconds before the decision.
      // Match the existing API time-filter encoding. Adding '=' to the key
      // produces a doubled operator on OpenF1. The engine enforces <= cutoff.
      const read=async(endpoint,params)=>{try{return await apiFetch(endpoint,params);}catch(error){if(/OpenF1 HTTP 404/.test(error.message))return [];throw error;}};
      const upper=new Date(cutoff+1).toISOString();
      const positions=await read("position",{session_key:sessionKey,"date<":upper});
      const intervals=await read("intervals",{session_key:sessionKey,"date>":new Date(cutoff-20000).toISOString(),"date<":upper});
      extra={positions,intervals};raceReplay.cache.set(cacheKey,extra);if(raceReplay.cache.size>12)raceReplay.cache.delete(raceReplay.cache.keys().next().value);
    }
    if(request!==raceReplay.request||generation!==state.generation||key!==raceRequestKey()||!raceSessionAllowed())return;
    const c=state.sessionContext;
    raceReplay.raw={drivers:state.drivers,laps:state.laps,stints:c.stints,pits:c.pits,raceControl:c.raceControl,weather:c.weather,positions:extra.positions,intervals:[...extra.intervals,...[...(c.intervals||new Map()).values()].flat()]};
    raceReplay.cutoff=cutoff;raceReplay.key=key;
  }catch(error){if(request===raceReplay.request){raceReplay.error=replayErrorCopy(error);raceReplay.key=null;}}
  finally{if(request===raceReplay.request){raceReplay.loading=false;renderRaceReplay();}}
}
function raceReason(reason){return ({age_support_hold:tr("Requested ages exceed the model support; no scenario is available with these inputs.","요청한 타이어 나이가 모델 지원 범위를 벗어나 현재 입력으로 계산할 수 없습니다."),select_two_drivers:tr("Choose two different drivers.","서로 다른 두 드라이버를 선택하세요."),no_recent_completed_lap:tr("A recent completed lap is missing; retirement/current running state is unknown.","최근 완료 랩이 없어 현재 주행·리타이어 상태를 판단할 수 없습니다."),insufficient_pace_age_data:tr("A current-stint fit needs three usable laps with known tyre age and recorded or inferred GREEN. Inspect the exclusion counts below.","현재 stint에 나이가 알려지고 기록·추정 GREEN인 유효 랩 3개 이상이 필요합니다. 아래 제외 사유를 확인하세요."),missing_stale_or_lapped_gap:tr("Gap is missing, older than 15 seconds, or expressed in laps. No conversion to invented seconds.","간격이 없거나 15초 이상 오래되었거나 랩 단위입니다. 임의의 초 단위 값으로 바꾸지 않습니다."),asynchronous_gaps:tr("A/B gap timestamps differ by more than 5 seconds.","A/B 간격 관측시각 차이가 5초를 넘습니다."),new_compound_has_no_prior_fit:tr("The replacement compound has no usable fit before the decision point.","선택 시점 이전에 교체할 컴파운드의 유효 모델이 없습니다."),unknown_or_red_control:tr("Recorded track status is unknown/red/finished. Select an explicit GREEN/SC/VSC counterfactual to explore, not an inferred restart.","기록상 상태가 불명확하거나 적기·종료 상태입니다. 탐색하려면 명시적으로 GREEN/SC/VSC 가정을 선택하세요. 재개를 추정하지 않습니다.")})[reason]||reason;}
function raceTable(headers,rows){if(!rows.length)return `<p class="engineering-note">${tr("No usable rows at this decision point.","이 판단 시점에서 사용 가능한 행이 없습니다.")}</p>`;return `<div class="table-scroll"><table class="analysis-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;}
function raceValue(v,d=2){return Number.isFinite(v)?v.toFixed(d):"—";}
function raceDecisionSummary(snap,r){
  const models=[r.a?.pace,r.b?.pace].filter(Boolean),negative=models.some(m=>m.slope<0),held=!!r.reason||!r.scenarios.some(s=>!s.unavailable);
  const heading=held?tr("Conclusion: prediction withheld","결론: 예측 보류"):tr("Conclusion: conditional linear comparison","결론: 가정에 따른 선형 비교");
  const body=r.reason?raceReason(r.reason):held?(negative?tr("The fitted pace-age trend is negative and the requested replacement/continuation needs extrapolation. The model cannot identify a fresh-tyre gain here. Track evolution, fuel assumptions, traffic and tyre history may contribute; this dataset cannot isolate the cause. Keep the observations, withhold the pit recommendation.","관측 페이스–나이 추세가 음수이고 요청한 교체·주행에는 외삽이 필요합니다. 여기서는 신품 타이어 이득을 식별할 수 없습니다. 트랙 변화·연료 가정·교통·타이어 이력이 영향을 줄 수 있지만 원인은 분리할 수 없습니다. 관측 결과는 남기고 피트 권고를 보류합니다."):raceReason(r.reason||"age_support_hold")):tr("Compare lap-step totals under the chosen fuel, tyre-reset and rival-stop assumptions. The engine does not identify a tyre thermal transient, degradation cliff or on-track passing. A small model difference alone is not an undercut recommendation.","연료·타이어 나이 초기화·상대 정차 가정에 따른 랩별 합계를 비교합니다. 타이어 열 과도·비선형 cliff·실제 추월은 식별하지 않습니다. 작은 모델 차이만으로 언더컷을 권고하지 않습니다.");
  const evidence=(r.replacementEvidence||[]).map(e=>`<li>${esc(raceName(e.driver))} · ${esc(e.compound||"—")} · S${e.stint??"—"}: ${e.stint==null?tr("No replacement fit is available","교체 타이어 적합 근거 없음"):e.sameAsCurrent?tr("replacement reuses the CURRENT stint fit at age 0; no independent new-set validation","교체 성능은 현재 stint 회귀선을 나이 0으로 되감은 값 · 독립 신품 검증 없음"):tr("replacement uses an earlier same-driver fit; transfer to a new set is unvalidated","교체 성능은 이전 동일 드라이버 적합을 사용 · 신품 세트로의 전이 미검증")}</li>`).join("");
  return `<section class="race-methods"><h3>${heading}</h3><p class="engineering-note">${esc(body)}</p><ul>${evidence}</ul></section>`;
}
function verdict(delta,hw){
  if(!Number.isFinite(delta)||!Number.isFinite(hw))return {cls:"hold",text:tr("not computed","계산 안 함")};
  if(Math.abs(delta)<=hw)return {cls:"flat",text:tr("not distinguished","구분 안 됨")};
  return delta<0?{cls:"good",text:tr("favours A","유리")}:{cls:"warn",text:tr("against A","불리")};
}
function singleTerm(scenario,baseline){
  if(!scenario||scenario.unavailable||!baseline||baseline.unavailable)return null;
  const w=RaceEngine.contrastWeights(scenario.weights,baseline.weights);
  const live=Object.entries(w).filter(([,v])=>v.w0!==0||v.w1!==0);
  if(live.length!==1)return null;
  const [key,v]=live[0];
  if(v.w0!==0||!Number.isFinite(v.w1)||!Number.isFinite(v.model?.slope))return null;
  // A single regression term does not imply that traffic/neutralisation constants cancel.
  const delta=scenario.finishGap-baseline.finishGap;
  if(!Number.isFinite(delta)||Math.abs(delta-v.w1*v.model.slope)>1e-8)return null;
  return {key,w1:v.w1,model:v.model};
}
function signMargin(snap,aId,bId,inputs,id){
  const current=RaceEngine.evaluate(snap,aId,bId,inputs),now=singleTerm(current.scenarios.find(s=>s.id===id),current.scenarios.find(s=>s.id==="together"));
  if(!now||now.model.slope===0)return null;
  const sign=Math.sign(now.w1);
  for(let step=1;step<=20;step++)for(const H of [inputs.horizon+step,inputs.horizon-step]){
    if(H<3||H>30||H<=inputs.delay)continue;
    const alt=RaceEngine.evaluate(snap,aId,bId,{...inputs,horizon:H}),scenario=alt.scenarios.find(s=>s.id===id),base=alt.scenarios.find(s=>s.id==="together"),c=alt.comparisons?.find(c=>c.id===id);
    if(!scenario||scenario.unavailable||!base||base.unavailable||!c)continue;
    const weights=RaceEngine.contrastWeights(scenario.weights,base.weights);
    // At exact cancellation singleTerm returns null: detect the zero separately.
    if(weights[now.key]&&Object.values(weights).every(v=>v.w0===0&&v.w1===0)&&Math.abs(c.delta)<1e-8)return {H,laps:Math.abs(H-inputs.horizon),zero:true};
    const t=singleTerm(scenario,base);
    if(t&&t.key===now.key&&Math.sign(t.w1)!==sign)return {H,laps:Math.abs(H-inputs.horizon),zero:false};
  }
  return null;
}
function raceBoundaryExplanation(r,labels,snap){
  const baseline=r.scenarios?.find(s=>s.id==="together");let html="";
  for(const c of r.comparisons||[]){
    const scenario=r.scenarios.find(s=>s.id===c.id),term=singleTerm(scenario,baseline);if(!term)continue;
    const margin=signMargin(snap,r.a.driver,r.b.driver,r.inputs,c.id);
    html+=`<p class="race-boundary"><b>${labels[c.id]}</b> · ${tr("coefficient","계수")} ${signed(term.w1,0)} × ${tr("slope","기울기")} ${signed(term.model.slope,4)} = ${signed(c.delta,3)}s${margin?`<span>${margin.zero?tr(`Moving the evaluation endpoint ${margin.laps} laps (H=${margin.H}) makes this difference zero.`,`평가 종료 시점을 ${margin.laps}랩 옮기면(H=${margin.H}) 이 차이가 0이 됩니다.`):tr(`Moving the evaluation endpoint ${margin.laps} laps (H=${margin.H}) reverses this difference's sign.`,`평가 종료 시점을 ${margin.laps}랩 옮기면(H=${margin.H}) 이 차이의 부호가 바뀝니다.`)}</span>`:""}</p>`;
  }
  return html?`<section class="race-boundaries" aria-label="${tr("Evaluation endpoint and sign boundary","평가 종료 시점과 부호 경계")}">${html}<p class="race-boundary-note">${tr("Coefficient: difference in summed tyre ages, in lap units. This holds only within these model assumptions, not as a passing condition or tyre-life margin.","계수는 타이어 나이 합계의 차이이며 단위는 랩입니다. 현재 모델 가정 안에서만 성립하며 실제 추월 조건이나 타이어 수명 여유가 아닙니다.")}</p></section>`:"";
}
function raceMechanismAndFuel(r,labels){
  if(!r.fuelSensitivity?.length)return "";
  let html=`<h3>${tr("Fuel assumption versus fit uncertainty","연료 가정 변화와 적합 불확실성")}</h3><div class="race-fuel-grid">`;
  for(const id of ["undercut","overcut"]){
    const rows=r.fuelSensitivity.filter(f=>f.comparisons?.some(c=>c.id===id));if(!rows.length)continue;
    const values=rows.flatMap(f=>f.comparisons.filter(c=>c.id===id&&c.supported&&Number.isFinite(c.algebraicDelta)).map(c=>Math.abs(c.algebraicDelta))),max=Math.max(0,...values);
    html+=`<div class="race-fuel-strip"><h4>${labels[id]} − ${tr("both now","둘 다 지금")}</h4>`;
    for(const f of rows){
      const c=f.comparisons.find(c=>c.id===id),valid=c.supported&&Number.isFinite(c.algebraicDelta),value=c.algebraicDelta,width=valid&&max>0?50*Math.abs(value)/max:0;
      html+=`<div class="fuel-row ${f.fuel===r.inputs.fuelGain?"selected":""}"><span>${raceValue(f.fuel,3)}${f.fuel===r.inputs.fuelGain?`<small>${tr("applied","적용값")}</small>`:""}</span><div class="fuel-track" aria-hidden="true">${valid?`<i class="${value<0?"negative":"positive"}" style="width:${width}%;left:${value<0?50-width:50}%"></i>`:""}</div><strong>${valid?signed(value,2)+"s":tr("forecast withheld","예측 보류")}</strong></div>`;
    }
    html+="</div>";
  }
  html+=`</div><p class="engineering-note">${tr("0–0.15 is the allowed input range, not a measured fuel interval or probability bound. These rows refit the same observations at the endpoints and selected value. Slope(f)=raw slope+f; tyre degradation, track evolution and fuel-correction error are inseparable here. Parameter-only intervals above hold fuel fixed; they omit future lap scatter and structural error and are NOT a guaranteed lower bound on total forecast uncertainty.","0–0.15는 입력 허용 범위이며 실측 연료 구간이나 확률 범위가 아닙니다. 같은 관측값을 양 끝값과 선택값에서 다시 적합했습니다. 기울기(f)=원시 기울기+f이며 타이어 열화·트랙 변화·연료 보정 오차는 여기서 분리되지 않습니다. 위 모수 구간은 연료를 고정하고 미래 랩 변동·구조 오차를 제외합니다. 전체 예측 불확실성의 보장된 하한도 아닙니다.")}</p>`;
  return html;
}
function raceRestartDetails(snap){
  const rows=snap.restartDiagnostics||[];
  return `<details class="race-methods"><summary>${tr("Restart reconstruction · inference and elapsed time","재시작 재구성 · 추정과 경과 시간")}</summary>`+raceTable([tr("Notice · UTC","통보 · UTC"),tr("Type / result","유형 / 처리"),tr("Elapsed from notice · s","통보 후 경과 · 초"),tr("Evidence","근거")],rows.map(d=>`<tr><td>${esc(d.sourceDate)}</td><td>${d.kind} · ${d.status}</td><td>+${raceValue(d.elapsedSeconds,1)}${d.status==='RESTART_UNCONFIRMED'?` · ${tr("timed out, not a release","제한 시간 도달 · 해제 아님")}`:''}</td><td>${esc(d.message)}</td></tr>`))+`<p class="engineering-note">${tr("Verified 2023–2026 VSC rules use the late +15s bound, marked inferred. Lap-based recovery requires a complete lap at notice lap+1 or +2, within 300s (600s for red restart procedures, which may include formation and grid reforming). These time caps are data-quality assumptions, not FIA release rules. Failed recovery remains excluded as RESTART_UNCONFIRMED until new evidence; UNKNOWN laps are also excluded. Missing original laps are not recovered.","확인한 2023–2026 VSC 규정의 +15초 경계를 사용하되 추정으로 표시합니다. 랩 기반 복귀는 통보 랩+1 또는 +2의 완료 랩과 300초 이내라는 조건을 모두 요구합니다. 적기 재시작은 포메이션·그리드 재정렬을 고려해 600초 이내로 제한합니다. 이 상한은 자료 품질 가정이며 FIA 해제 규정이 아닙니다. 실패는 RESTART_UNCONFIRMED로 남겨 새 근거가 올 때까지 제외하고 UNKNOWN 랩도 제외합니다. 누락된 원본 랩은 복원하지 않습니다.")}</p></details>`;
}
function scheduleCutoffAvailability(laps,inputs){
  const raw=raceReplay.raw;if(!raw||!laps.length)return;
  if(cutoffAvailability.raw!==raw){cutoffAvailability.raw=raw;cutoffAvailability.key=null;cutoffAvailability.cache.clear();}
  const key=JSON.stringify([raceReplay.selectionKey,inputs,raw.intervals.length,tr("en","ko")]);
  if(cutoffAvailability.key===key)return;
  cutoffAvailability.key=key;const generation=++cutoffAvailability.generation;
  const aId=raceDriver("a"),bId=raceDriver("b");
  const apply=rows=>{let usable=0;for(const row of rows){const option=[...$("race-cutoff").options].find(o=>Number(o.value)===row.lap);if(!option)continue;const status=row.usable?tr("READY","가능"):row.needsGap?tr("GAP SNAPSHOT NEEDED","간격 기록 필요"):tr("HOLD","보류");option.textContent=`${raceName(aId)} · L${row.lap} · ${status}`;if(row.usable)usable++;}$("race-availability-status").textContent=tr(`${usable}/${rows.length} cutoffs support at least one scenario with these inputs and currently loaded records. No new requests.`,`${rows.length}개 시점 중 ${usable}개에서 현재 입력·로드된 기록으로 시나리오 1개 이상 계산 가능합니다. 추가 요청은 없습니다.`);};
  if(cutoffAvailability.cache.has(key)){apply(cutoffAvailability.cache.get(key));return;}
  $("race-availability-status").textContent=tr("Checking available cutoffs with loaded records…","로드된 기록으로 분석 가능한 시점을 확인하는 중…");
  const rows=[];let index=0;
  const next=()=>{if(generation!==cutoffAvailability.generation)return;const lap=laps[index++],snap=RaceEngine.snapshot(raw,RaceEngine.end(lap),inputs.fuelGain,inputs.maxExtrapolation),a=snap.rows.find(r=>r.driver===aId),b=snap.rows.find(r=>r.driver===bId),reason=RaceEngine.validPair(a,b),condition=inputs.condition==="observed"?snap.control.status:inputs.condition;
    const trackOK=/^(GREEN|SC|VSC)/.test(condition);
    const usable=!reason&&trackOK&&[[0,inputs.delay],[inputs.delay,0],[0,0]].some(([x,y])=>!!RaceEngine.simulatePair(a,b,inputs,x,y,condition));
    rows.push({lap:Number(lap.lap_number),usable:!!usable,needsGap:["missing_stale_or_lapped_gap","asynchronous_gaps"].includes(reason)});
    if(index<laps.length)setTimeout(next,0);else{cutoffAvailability.cache.set(key,rows);if(cutoffAvailability.cache.size>8)cutoffAvailability.cache.delete(cutoffAvailability.cache.keys().next().value);apply(rows);}};
  setTimeout(next,0);
}
function renderRaceResults(snap,r){
  const name=d=>esc(raceName(d)),title=(en,ko)=>`<h3>${tr(en,ko)}</h3>`,note=(en,ko)=>`<p class="engineering-note">${tr(en,ko)}</p>`;
  const labels={undercut:tr("A stops now","A 지금 정차"),overcut:tr(`A stops in ${r.inputs.delay} laps`,`A ${r.inputs.delay}랩 뒤 정차`),together:tr("Both stop now","둘 다 지금 정차")};
  const source=r.conditionSource==="recorded"?tr("recorded","기록"):r.conditionSource==="inferred_from_records"?tr("inferred","추정"):tr("assumed","가정");
  let html=`<div class="race-ctx"><span>${esc(sessionTitle(raceSession()))}</span><span><em>${name(raceDriver("a"))} / ${name(raceDriver("b"))}</em></span>${r.a?.lastLap!=null?`<span>${tr("Decision","판단 시점")} L${r.a.lastLap}</span>`:""}<span>${tr("Evaluate at","평가 종료")} +${r.inputs.horizon} ${tr("laps","랩")}</span><span>${tr("Delayed stop","지연 정차")} +${r.inputs.delay} ${tr("laps","랩")}</span><span>${esc(r.condition)} · ${source}</span></div>`;
  const baseline=r.scenarios?.find(s=>s.id==="together");
  if(r.reason)html+=`<p class="race-hold">${esc(raceReason(r.reason))}</p>`;
  else if(r.scenarios?.length){
    html+=`<h3 class="race-ledger-title">${tr("Difference from both stopping now","둘 다 지금 정차 대비 차이")}</h3><div class="race-ledger">`;
    for(const id of ["undercut","overcut","together"]){
      const scenario=r.scenarios.find(s=>s.id===id),c=r.comparisons?.find(c=>c.id===id),base=id==="together";
      const ready=base?scenario&&!scenario.unavailable:Number.isFinite(c?.delta)&&!scenario?.unavailable;
      const chip=base&&ready?{cls:"flat",text:tr("comparison baseline","비교 기준")}:verdict(ready?c?.delta:null,ready?c?.fitHalfWidth:null);
      const reason=!ready?(baseline?.unavailable&&!scenario?.unavailable?tr("Baseline outside age support / negative-trend extrapolation","기준 시나리오: 나이 지원 범위 밖 / 음수 추세 외삽"):tr("Outside age support / negative-trend extrapolation","나이 지원 범위 밖 / 음수 추세 외삽")):"";
      const value=!ready?tr("withheld","보류"):base?tr("baseline","기준"):signed(c.delta,2);
      html+=`<div class="row ${base?"base":""}" data-scenario="${id}"><div><strong>${labels[id]}</strong><small>${scenario?`${tr("Stop offsets A:B","정차 지연 A:B")} · ${scenario.stopA}:${scenario.stopB}`:""}</small>${reason?`<small class="d-hold">${reason}</small>`:""}${c?.parameterCancellation?`<small>${tr("Regression-parameter contribution cancels; real-world uncertainty is not zero","회귀 모수 기여 상쇄 · 실제 불확실성 0이 아님")}</small>`:""}</div><div class="delta d-${chip.cls}">${value}${ready?`<span class="pm">${base?"0.00s":Number.isFinite(c.fitHalfWidth)?`±${raceValue(c.fitHalfWidth)}s`:tr("interval unavailable","구간 미제공")}</span>`:""}</div><span class="race-chip chip-${chip.cls}">${chip.text}</span></div>`;
    }
    html+=`</div>`+note("Negative Δ favours A relative to both stopping now. These are differences from the baseline, not absolute endpoint gaps.","음수 Δ는 ‘둘 다 지금 정차’보다 A에 유리한 방향입니다. 표시값은 기준 대비 차이이며 종점 절대 간격이 아닙니다.");
    html+=note("± is the paired parameter-only ~95% interval, not total forecast uncertainty. The chips describe this conditional comparison, not a strategy recommendation.","±는 공유 모수 오차 상쇄 후 회귀 모수만의 약 95% 구간이며 전체 예측 불확실성이 아닙니다. 칩은 이 조건부 비교를 설명하며 전략 권고가 아닙니다.");
    html+=raceBoundaryExplanation(r,labels,snap);
  }
  $("race-result-head").innerHTML=html;
  $("race-primary-inputs").hidden=!!r.reason;
  for(const id of ["strategy-horizon","strategy-delay","strategy-fuel-gain"]){
    const input=$(id);if(input?.closest){const target=$(r.reason?"race-other-grid":"race-primary-grid");if(input.closest("label").parentElement!==target)target.append(input.closest("label"));}
  }
  $("race-assumptions-count").textContent=tr(`${r.reason?18:15} adjustable inputs`,`${r.reason?18:15}개 조정 입력`);
  $("race-fuel").innerHTML=!r.reason&&r.fuelSensitivity?.length?raceMechanismAndFuel(r,labels):"";
  html="";
  html+=title("Pace & tyre evidence before the cutoff","선택 시점 이전의 페이스·타이어 근거");
  html+=raceTable([tr("Driver / compound / stint","드라이버 / 타이어 / stint"),tr("Fit laps / age span","적합 랩 / 사용 나이 범위"),tr("Pace-age slope","페이스–사용 랩 기울기"),"R² · in-sample",tr("Next lap / fresh pace","다음 랩 / 신품 페이스")],[r.a,r.b].filter(Boolean).flatMap(row=>row.models.map(m=>`<tr><td>${name(row.driver)} · ${esc(m.compound)} · S${m.stint}</td><td>${m.n} · ${m.minAge}–${m.maxAge}</td><td>${signed(m.slope,3)}s/lap</td><td>${raceValue(m.r2)}</td><td>${raceValue(RaceEngine.supported(m,row.age,r.inputs.maxExtrapolation)?RaceEngine.paceAt(m,row.age,row.lastLap+1,snap.fuelGain):null)} / ${raceValue(RaceEngine.supported(m,0,r.inputs.maxExtrapolation)?RaceEngine.paceAt(m,0,row.lastLap+1,snap.fuelGain):null)}s${m.minAge>0?" · age 0 extrapolation":""} · next age ${row.age} ${row.age>m.maxAge?"HIGH-AGE EXTRAPOLATION":""}${m.slope<0?" · negative trend: no extrapolation":""}<br>${m.trafficUnknown} ${tr("laps: traffic unknown","랩: 교통 불명")}, ${m.controlRecorded} ${tr("recorded GREEN","기록 GREEN")} / ${m.controlInferred} ${tr("inferred GREEN","추정 GREEN")} / ${m.controlUnknown} ${tr("unknown","불명")}</td></tr>`)));
  html+=raceTable([tr("Stint coverage","stint 근거 범위"),tr("Used / completed laps","사용 / 완료 랩"),tr("Excluded: unknown control / restart unconfirmed","제외: 상태 불명 / 재시작 미확인")],[r.a,r.b].filter(Boolean).flatMap(row=>row.diagnostics.map(d=>`<tr><td>${name(row.driver)} · S${d.stint} · ${esc(d.compound)}</td><td>${d.used} / ${d.total} (${Math.round(100*d.used/Math.max(1,d.total))}%)${d.used<3?" · insufficient fit":""}</td><td>${d.unknownControlExcluded??0} / ${d.restartUnconfirmedExcluded??0}</td></tr>`)));
  html+=note("Track evolution, fuel-correction error and tyre age are not separately identifiable within a stint. Negative slopes are descriptive only; extrapolation is withheld. The editable age allowance controls extrapolation, not tyre life. Widening it does not validate predictions.","stint 내부에서 트랙 변화·연료 보정 오차·타이어 나이 효과는 분리 식별할 수 없습니다. 음수 기울기는 관측 관계로만 표시하고 외삽은 보류합니다. 외삽 허용 랩은 위에서 바꿀 수 있는 모델 가정이며 타이어 수명 한계가 아닙니다. 허용 범위를 넓혀도 예측이 검증되는 것은 아닙니다.");
  html+=note("Slope is observed pace-age association after assumed fuel correction, not identified tyre wear or grip. New-tyre pace can extrapolate below sampled ages. Different compounds use their own earlier stint fit; availability and legality of another tyre set are not established.","기울기는 가정한 연료 보정 후의 페이스–사용 랩 관계이며 순수 마모·그립 식별값이 아닙니다. 신품 페이스는 관측 나이 밖 외삽일 수 있습니다. 다른 컴파운드는 그 시점 이전의 별도 stint 적합을 사용하며 남은 타이어 재고·사용 규정 충족 여부는 확인하지 않습니다.");
  html+=`<h3>${tr("Field at the decision point","판단 시점의 전체 필드")}</h3>`;
  html+=raceTable([tr("Pos / driver","순위 / 드라이버"),tr("Last completed lap","마지막 완료 랩"),tr("Tyre / completed age","타이어 / 완료 사용 랩"),tr("Gap to leader / sample age","선두 간격 / 표본 경과"),tr("Next lap pace · estimate","다음 랩 페이스 · 추정")],snap.rows.map(row=>`<tr><td>${row.recent?(row.position??"—"):tr("NOT RUNNING / UNCONFIRMED","주행 미확인")} · ${name(row.driver)}</td><td>L${row.lastLap??"—"} · ${raceValue(row.lastLapTime,3)}s</td><td>${esc(row.compound||"—")} · ${row.age??"—"}</td><td>${row.gap===null?esc(row.gapRaw??"—"):raceValue(row.gap)+"s"} · ${raceValue(row.gapAge,1)}s${row.gap===null?" · unavailable for strategy":""}</td><td>${raceValue(row.nextPace)}s</td></tr>`));
  html+=note("Positions are latest recorded changes. Gap samples are not simultaneous: numeric strategy gaps must be ≤15s old, paired within 5s. Tyre age is after the last completed lap; in-progress lap fraction is unknown. Archived times cannot recreate original data arrival delays.","순위는 마지막 기록된 변경값입니다. 전략에 쓰는 초 단위 간격은 경과 15초 이하·서로 5초 이내여야 합니다. 타이어 나이는 마지막 완료 랩 기준이며 진행 중 랩의 사용분은 불명확합니다. 기록시각으로 당시 수신 지연까지 재현하지는 않습니다.");
  html+=note(`Weather at cutoff: ${snap.weather ? "track " + raceValue(snap.weather.track_temperature,1) + " °C · rainfall " + snap.weather.rainfall : "unavailable"}`,`판단 시점 날씨: ${snap.weather ? "노면 " + raceValue(snap.weather.track_temperature,1) + " °C · 강수 보고 " + snap.weather.rainfall : "관측 없음"}`);

  html+=title("Pit loss under GREEN / SC / VSC","GREEN / SC / VSC 피트 손실");
  html+=`<div class="race-kpis">${Object.entries(r.savings).map(([k,v])=>`<article><span>${k}</span><strong>${raceValue(v)}s</strong></article>`).join("")}</div>`;
  html+=note("Shared GREEN pit loss cancels in A−B after both stops, but changes temporary gaps and frozen-field rejoin. A/B warm-up costs are separate assumptions. SC/VSC factors affect net pit loss only; queue compression and restart dynamics are absent. No absolute neutralised lap time is predicted.","공통 GREEN 피트 손실은 양쪽 정차 후 A−B에서 상쇄되지만 중간 간격과 재합류에는 영향을 줍니다. A/B 워밍업 손실은 별도 가정입니다. SC/VSC 배율은 피트 손실에만 적용합니다. 대열 압축·재시작은 미구현이며 중립화 절대 랩타임을 예측하지 않습니다.");

  if(!r.reason&&r.scenarios?.length){
    html+=title("Pair gap after both stops","두 차량 모두 피트한 뒤의 간격");
    html+=raceTable([tr("Scenario / stop offsets A:B","시나리오 / 피트 지연 A:B"),tr("At common horizon · A−B","동일 종료 시점 · A−B"),tr("Parameter-only ~95% interval","모수 추정만의 약 95% 구간"),tr("Assumption range","입력 가정 범위"),tr("After both stops · different times","피트 완료 직후 · 시점 다름")],r.scenarios.map(s=>`<tr><td>${labels[s.id]} · ${s.stopA}:${s.stopB}</td>${s.unavailable?`<td colspan="4">${tr("Withheld: age support / negative-trend extrapolation. Shorten horizon or inspect another cutoff.","보류: 나이 범위 초과 / 음수 추세 외삽. 예측 기간을 줄이거나 다른 시점을 확인하세요.")}</td>`:`<td>${signed(s.finishGap,2)}s${s.warnings.includes("age_extrapolation")?` · ${tr("outside fit: lower","적합 밖: 낮은 나이")} ${s.extrapolation.low} / ${tr("higher","높은 나이")} ${s.extrapolation.high} ${tr("laps","랩")}`:""}</td><td>±${raceValue(s.fitHalfWidth)}s</td><td>${s.rangeAtHorizon.map(v=>signed(v,2)).join(" … ")}s</td><td>+${s.bothStoppedAt} laps · ${signed(s.afterBoth,2)}s</td>`}</tr>`));
    html+=raceGapChart(r.scenarios,labels);
  }
  $("race-evidence-body").innerHTML=html;
  html="";
  if(!r.reason&&r.pitWindows?.length){
    html+=title("A stop-window scan · B stops after selected delay","A 피트 시점 비교 · B는 지정한 지연 후 정차");
    const usable=r.pitWindows.filter(w=>Number.isFinite(w.finishGap)),best=usable.length?usable.reduce((a,b)=>a.finishGap<b.finishGap?a:b):null;
    html+=note(best?`Lowest horizon A−B in these candidates: stop A after ${best.offset} laps, ${signed(best.finishGap,2)}s. Conditional on the chosen B response and assumptions; not a global optimum.`:"No valid candidates.",best?`이 후보 중 범위 종료 A−B가 가장 작은 시점: A ${best.offset}랩 지연, ${signed(best.finishGap,2)}초. 지정한 B 대응·가정에만 해당하며 전체 최적 전략이 아닙니다.`:"유효 후보가 없습니다.");
    html+=note("A boundary minimum is only best among supported candidates, not a demonstrated optimum. Adjacent delay cost includes old-tyre pace AND replacement-tyre age at the horizon; shared pit loss cancels. No universal old-pace = fresh-pace crossing rule applies.","경계 최솟값은 근거가 있는 후보 안에서만 가장 작다는 뜻이며 최적 피트 시점의 증명이 아닙니다. 1랩 지연 비용에는 기존 타이어 페이스와 종료 시점의 교체 타이어 나이가 함께 들어갑니다. 공통 피트 손실은 상쇄되며 단순 기존=신품 페이스 교차점 규칙은 적용되지 않습니다.");
    const support=r.scanSupport;
    if(support.missing.length)html+=note(`${support.missing.length}/${support.total} candidates withheld: offsets ${support.missing.join(", ")}. Later stops need older-tyre extrapolation; removing them limits comparisons and may hide better late candidates.`,`${support.total}개 중 ${support.missing.length}개 후보 보류: +${support.missing.join(", +")}랩. 늦은 정차는 고령 타이어 외삽을 더 요구합니다. 제외된 후보가 더 나을 가능성을 이 스캔으로 판단할 수 없습니다.`);
    if(support.positiveSlopeShortHorizon)html+=note(`Same fitted line + positive slope + age ${support.age} > horizon−1 (${support.horizonMinusOne}) make every supported delay cost positive here. The early minimum follows these assumptions; extending the horizon changes the question, not the evidence.`,`동일 회귀선·양수 기울기·현재 나이 ${support.age} > 예측 범위−1 (${support.horizonMinusOne})의 조합 때문에 여기서는 지연 비용이 모두 양수입니다. 조기 정차 최솟값은 이 가정의 결과입니다. 범위를 늘리면 질문이 달라지며 근거가 추가되지는 않습니다.`);
    html+=`<div class="race-window-strip">${r.pitWindows.map(w=>`<div class="${w.offset===best?.offset?"best":""}"><span>+${w.offset} laps</span><strong>${Number.isFinite(w.finishGap)?signed(w.finishGap,2)+"s":tr("Age support hold","나이 범위 보류")}</strong><small>Δ +1 lap: ${Number.isFinite(w.nextLapDelayCost)?signed(w.nextLapDelayCost,2)+"s":tr("Next candidate outside support / scan","다음 후보가 근거·스캔 범위 밖")}</small></div>`).join("")}</div>`;
  }
  $("race-scan-body").innerHTML=html;
  $("race-scan-section").hidden=!!r.reason||!r.pitWindows?.length;
  html="";
  if(!r.reason){
    html+=title("Pit rejoin & traffic exposure","피트 재합류·교통 노출");
    if(r.rankHold)html+=note("SC/VSC: exact rejoin rank and undercut success are withheld. The gap curves assume a common neutralised lap pace and do not model SC queue compression, restart phase or safety-car pickup.","SC/VSC에서는 재합류 순위·언더컷 성공 판정을 보류합니다. 간격 곡선은 공통 중립화 페이스를 가정하며 SC 대열 압축·재시작 단계·SC 뒤 합류는 모델링하지 않습니다.");
    else if(r.rejoin){const j=r.rejoin;html+=`<div class="race-kpis"><article><span>${tr("Frozen-field rejoin estimate","필드 간격 고정 재합류 추정")}</span><strong>${j.fullField?"P":"~"}${j.rank} / ${j.among}</strong></article><article><span>${tr("Car ahead / gap","앞차 / 간격")}</span><strong>${j.ahead?name(j.ahead.driver)+" · "+raceValue(j.ahead.gap)+"s":"—"}</strong></article><article><span>${tr("Car behind / gap","뒤차 / 간격")}</span><strong>${j.behind?name(j.behind.driver)+" · "+raceValue(j.behind.gap)+"s":"—"}</strong></article></div>`;html+=note("Rejoin freezes other cars' current gaps and adds A's net pit loss. No other stops, field pace evolution, pit-exit geometry or lapped-car conversion. A partial field is not a classified race position. Front/rear gaps are shown directly: 1.5s is not a universal dirty-air boundary. Use post-stop traffic inputs to explore assumed losses.","재합류는 다른 차량의 현재 간격을 고정하고 A의 순수 피트 손실을 더한 근사값입니다. 다른 차량의 피트·페이스 변화·출구 위치·랩다운 환산은 포함하지 않습니다. 일부 차량만 포함되면 전체 순위가 아닙니다. 앞뒤 간격을 직접 표시하며 1.5초를 보편적인 더티에어 경계로 보지 않습니다. 피트 후 교통 입력은 가정한 손실 탐색용입니다.");}
  }
  $("race-rejoin-body").innerHTML=html;
  $("race-rejoin-section").hidden=!!r.reason||(!r.rankHold&&!r.rejoin);
  html=raceDecisionSummary(snap,r)+raceRestartDetails(snap).replace('<details class="race-methods"><summary>','<h3>').replace('</summary>','</h3>').replace('</details>','');
    html+=note("Fit-only intervals propagate intercept/slope covariance, including reuse of the same fit between scenarios. They assume independent residuals and independent stint fits; they are not calibrated forecast intervals and omit traffic, track evolution and model-form error. Input ranges remain separate. No operational strategy ranking.","적합 구간은 절편·기울기 공분산과 전략 간 동일 적합의 재사용을 반영합니다. 잔차와 stint 적합 간 독립을 가정하며 실제 예측 정확도가 검증된 구간이 아닙니다. 교통·트랙 변화·모델 형태 오차는 빠져 있고 입력 가정 범위는 별도로 표시합니다. 실전 전략 순위는 제시하지 않습니다.");
    html+=note("A−B < 0 means A ahead in the model. Both stops must be completed before interpreting a crossing. 'Now' is the next modelled pit opportunity, not an instantaneous move to pit exit. Negative gap is not a guaranteed on-track pass. Ranges are three explicit favourable/base/unfavourable input scenarios, not confidence intervals.","A−B가 음수면 모델에서 A가 앞섭니다. 양쪽 피트가 모두 완료된 뒤 비교해야 합니다. ‘지금’은 다음 모델상 피트 기회이며 즉시 피트 출구로 이동한다는 뜻이 아닙니다. 음수 간격이 실제 추월을 보장하지 않습니다. 범위는 유리·기준·불리한 세 가지 입력 가정이며 신뢰구간이 아닙니다.");

  html+=note("Coefficients are differences in summed tyre ages (lap units), not extra observed laps. In same-compound GREEN comparisons, each driver's fixed pit loss and one-off warm-up cancel between stop schedules once both stops are complete. They still change interim gaps. Linear pace-age association remains; thermal warm-up dynamics, cliff and position feedback are absent.","계수는 타이어 나이 합계의 차이(랩 단위)이며 추가 관측 랩 수가 아닙니다. 같은 컴파운드·GREEN에서 양쪽 정차가 끝나면 차량별 고정 피트 손실과 1회 워밍업 비용은 정차 일정 간 차분에서 상쇄됩니다. 중간 간격에는 영향을 줍니다. 남는 것은 선형 페이스–나이 관계이며 열적 워밍업 동역학·cliff·순위 피드백은 없습니다.");
  html+=note("H defines when accumulated performance is compared; d defines which car waits and for how long. Earlier stopping gains time first, while the later stopper has younger tyres afterwards. The boundary is a property of this linear comparison with both-now, not a passing condition. H*−H is not tyre life or a safety margin. Changing H changes the question, not the evidence. Current tyre age also affects the coefficient.","H는 누적 성능을 언제 비교할지, d는 어느 차가 얼마나 기다릴지를 정합니다. 일찍 교체하면 이득을 먼저 얻고, 늦게 교체한 차는 이후 더 젊은 타이어를 씁니다. 이 경계는 ‘둘 다 지금’ 대비 선형 비교의 성질이며 추월 조건이 아닙니다. H*−H는 타이어 수명이나 안전 여유가 아닙니다. H를 바꾸면 근거가 추가되는 것이 아니라 질문이 바뀝니다. 현재 타이어 나이도 계수에 영향을 줍니다.");
  html+=`<h3>${tr("Assumptions and reconstruction limits","가정·시점 재구성의 한계")}</h3><p>${tr("Completed laps only: lap start + duration ≤ cutoff. Fit excludes observed pit/in/out, first lap, >8%-slow, SC/VSC/red laps, and >20% lap-time exposure to sampled front gap 0–1.5s. Samples carry forward at most 10s; <80% coverage is unknown. These are explicit filter choices, not validated aerodynamic limits. Excluded laps still age the tyre. R² and prediction use the same OLS line. Net pit loss is a user assumption, not pit-lane duration. Replacement tyres start at age zero; one stop per car; no tyre inventory or mandatory-compound optimiser. Future SC/VSC duration is assumed, never read from later messages. Track-scoped GREEN is recognised. SC release estimated from subsequent lap completion is labelled GREEN_INFERRED; 2023–2026 VSC recovery uses the +15s bound of the FIA 10–15s rule, labelled inferred. Red recovery requires a resumption/procedure notice followed by a completed lap. Red periods with no such evidence remain excluded.","랩 시작+소요시간이 선택 시점 이하인 완료 랩만 사용합니다. pit/in/out·첫 랩·8% 이상 느린 랩·SC/VSC/적기·앞차 간격 0–1.5초에 랩 시간의 20% 넘게 노출된 랩을 제외합니다. 표본은 최대 10초 유지하고 관측률 80% 미만은 교통 불명으로 남깁니다. 이는 필터 가정이며 공력 검증 기준이 아닙니다. 제외 랩도 타이어 사용 나이에는 포함합니다. R²와 예측은 같은 OLS 직선입니다. 순수 피트 손실은 입력 가정이며 피트레인 체류시간이 아닙니다. 신품 나이 0·차량당 1회 정차이며 타이어 재고나 의무 컴파운드 최적화는 없습니다. 미래 SC/VSC 지속시간은 가정만 사용하며 이후 기록을 읽지 않습니다. Track 범위 GREEN을 인식합니다. SC 종료 이후 완료 랩으로 추정한 재개는 GREEN_INFERRED로 구분합니다. 2023–2026 VSC는 FIA 10–15초 규정의 +15초 경계로 추정 복귀합니다. 적기는 재개·절차 통보 후 완료 랩이 있어야 추정 복귀하며 근거가 없는 적기 이후 구간은 계속 제외합니다.")}</p><a href="https://openf1.org/docs/" target="_blank" rel="noreferrer">OpenF1 endpoint definitions</a>`;

  $("race-methods-body").innerHTML=html;
  $("race-assumptions-notes").innerHTML=note("For the same compound in GREEN, each car's fixed pit loss and one-off warm-up cancel between schedules after both stops; interim gaps and rejoin still change. SC/VSC factors can affect the difference when only one stop is neutralised. Tyre choice, extrapolation allowance and traffic costs do not generally cancel.","같은 컴파운드·GREEN에서 차량별 고정 피트 손실과 1회 워밍업은 양쪽 정차 후 일정 간 차이에서 상쇄되지만 중간 간격과 재합류에는 영향을 줍니다. SC/VSC 배율은 한쪽만 중립화 구간에 정차하면 차이에 영향을 줄 수 있습니다. 타이어 선택·외삽 허용 범위·교통 비용은 일반적으로 상쇄되지 않습니다.");
  $("race-evidence-count").textContent=tr(`${[r.a,r.b].filter(Boolean).reduce((n,row)=>n+row.models.length,0)} fits · ${snap.completedLaps} completed driver-laps`,`적합 ${[r.a,r.b].filter(Boolean).reduce((n,row)=>n+row.models.length,0)}건 · ${snap.completedLaps} 완료 드라이버-랩`);
  $("race-scan-count").textContent=r.pitWindows?.length?tr(`${r.pitWindows.filter(w=>Number.isFinite(w.finishGap)).length}/${r.inputs.horizon} candidates`,`후보 ${r.pitWindows.filter(w=>Number.isFinite(w.finishGap)).length}/${r.inputs.horizon}`):"";
  $("race-rejoin-count").textContent=r.rankHold?tr("SC/VSC · withheld","SC/VSC · 보류"):r.rejoin?`${r.rejoin.fullField?"P":"~"}${r.rejoin.rank} / ${r.rejoin.among}`:"";
}
function raceGapChart(scenarios,labels){
  const all=scenarios.filter(s=>!s.unavailable),values=all.flatMap(s=>s.points.map(p=>p.gap));if(!values.length)return "";
  const bound=Math.max(1,...values.map(Math.abs))*1.1,horizon=all[0].points.at(-1).lap;
  const y=v=>150-v/bound*130,x=v=>55+v/horizon*870;
  return `<figure class="race-gap-figure"><figcaption>${tr("Projected pair gap · A−B seconds","예상 차량 간격 · A−B 초")}</figcaption><svg viewBox="0 0 970 330" role="img" aria-label="${tr("Pair gap projection by scenario lap","시나리오 랩에 따른 차량 간격 예측")}"><line x1="55" x2="925" y1="150" y2="150" class="race-zero"/>${[-bound,0,bound].map(v=>`<text x="5" y="${y(v)+4}">${v.toFixed(1)}</text>`).join("")}${all.map((s,i)=>`<path class="race-curve race-curve-${i}" d="${s.points.map((p,j)=>`${j?"L":"M"}${x(p.lap).toFixed(1)},${y(p.gap).toFixed(1)}`).join(" ")}"/>${s.points.map(p=>`<circle class="race-point-${i}" cx="${x(p.lap)}" cy="${y(p.gap)}" r="3"><title>+${p.lap} laps · ${labels[s.id]} · ${signed(p.gap,2)}s</title></circle>`).join("")}`).join("")}${[0,Math.round(horizon/2),horizon].map(v=>`<text x="${x(v)}" y="320">+${v}</text>`).join("")}</svg><div class="race-chart-legend">${all.map((s,i)=>`<span class="race-label-${i}">${labels[s.id]}</span>`).join("")}</div></figure>`;
}
function raceExportPayload(){
  if(typeof flushPendingStrategyInputUpdate==='function')flushPendingStrategyInputUpdate();
  if(!raceSessionAllowed()||raceReplay.key!==raceRequestKey()||!raceReplay.result)return null;
  const cutoff=raceReplay.cutoff,raw=raceReplay.raw;
  const completed=raw.laps.filter(l=>RaceEngine.end(l)<=cutoff);
  const stints=raw.stints.map(s=>{const observed=completed.filter(l=>Number(l.driver_number)===Number(s.driver_number)&&Number(l.lap_number)>=Number(s.lap_start)&&Number(l.lap_number)<=Number(s.lap_end));return observed.length?{driver_number:s.driver_number,stint_number:s.stint_number,compound:s.compound,lap_start:s.lap_start,lap_end:Math.max(...observed.map(l=>Number(l.lap_number))),tyre_age_at_start:s.tyre_age_at_start}:null;}).filter(Boolean);
  return {schema_version:1,kind:"historical_race_scenario",session:{session_key:raceSession().session_key,title:sessionTitle(raceSession())},drivers:{a:raceDriver("a"),b:raceDriver("b")},snapshot:raceReplay.snapshot,scenario:raceReplay.result,observations:{laps:completed,stints,weather:raw.weather.filter(r=>RaceEngine.time(r.date)<=cutoff),positions:raw.positions.filter(r=>RaceEngine.time(r.date)<=cutoff),intervals:raw.intervals.filter(r=>RaceEngine.time(r.date)<=cutoff),race_control:raw.raceControl.filter(r=>RaceEngine.time(r.date)<=cutoff),pits:raw.pits.filter(r=>RaceEngine.time(r.date)<=cutoff)},provenance:{api:API_BASE,endpoint_docs:"https://openf1.org/docs/",no_future_event_results_in_model:true},limitations:"Event-time reconstruction, not packet-time. Linear tyre-age association, not tyre wear/grip. Conditional deterministic scenarios, not calibrated probability or guaranteed passing."};
}
$("race-load").addEventListener("click",loadRaceSnapshot);
$("race-cutoff").addEventListener("change",()=>{raceReplay.request++;raceReplay.loading=false;raceReplay.key=null;raceReplay.error=null;renderRaceReplay();if(!raceDemoActive())loadRaceSnapshot();});
document.querySelectorAll(".race-assumptions input,.race-assumptions select,#race-warmup-b").forEach(el=>{
  el.addEventListener("input",()=>scheduleStrategyInputUpdate());
  el.addEventListener("blur",()=>{syncRaceInputs({commit:true});scheduleStrategyInputUpdate();flushPendingStrategyInputUpdate();});
  el.addEventListener("change",()=>{
    const values=raceInputs(),keys={"race-max-extrapolation":"maxExtrapolation","race-neutral-laps":"neutralLaps","race-pace-range":"paceRange","race-pit-range":"pitRange","race-traffic-a":"trafficA","race-traffic-b":"trafficB","race-traffic-laps":"trafficLaps","race-warmup-b":"warmupB"};
    scheduleStrategyInputUpdate();flushPendingStrategyInputUpdate();
  });
});
$("race-export").addEventListener("click",()=>{const payload=raceExportPayload();if(!payload)return;const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download=`min-annie-ji-race-${raceSession().session_key}-lap${$("race-cutoff").value}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:"read_race_scenario",title:"Read historical race scenario",description:"Read the exact displayed cutoff, field snapshot, conditional pit scenarios and limitations. Not LIVE or a calibrated strategy prediction.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>raceExportPayload()||{status:"no_current_snapshot"}});}catch(_){/* optional browser support */}}
const primaryIds=["strategy-horizon","strategy-delay","strategy-fuel-gain"];
const inputGrids=[...document.querySelectorAll("#panel-strategy .assumption-grid")].filter(el=>!el.id);
for(const input of document.querySelectorAll("#panel-strategy input[type=number],#panel-strategy .race-assumptions select")){
  const label=input.closest("label");if(!label)continue;
  label.classList.add("field");
  $(primaryIds.includes(input.id)?"race-primary-grid":"race-other-grid").append(label);
  if(input.type==="number"){
    const note=document.createElement("small");note.id=input.id+"-effective";note.className="eff";note.setAttribute("aria-live","polite");label.append(note);
    input.setAttribute("aria-describedby",[...label.querySelectorAll("small[id]")].map(el=>el.id).join(" "));
  }
}
inputGrids.forEach(grid=>{if(!grid.children.length)grid.remove();});
$("race-primary-inputs").append($("strategy-effective"));
$("race-evidence-section").append($("race-status"),$("race-observed-summary"));
$("race-scan-section").append($("race-availability-status"));
$("race-methods-section").append($("race-intro"),$("race-selection-help"));
renderRaceReplay();

async function selectRaceExample(key){
  raceSource=key;const request=++raceCaseRequest;frozenRace=null;frozenRaceFailed=false;raceReplay.key=null;raceReplay.raw=null;raceReplay.error=null;raceReplay.selectionKey=null;$("race-cutoff").value="";
  // Reset case-specific assumptions visibly; subsequent edits recalculate in place.
  $("race-compound-a").innerHTML="";$("race-compound-b").innerHTML="";
  $("race-control").value="observed";
  renderRaceReplay();
  if(key==="current"){await loadRaceSnapshot();return;}
  try{
    let data=frozenRaceCases.get(key);
    if(!data){const response=await fetch("./data/"+raceCaseFiles[key]);if(!response.ok)throw Error("Example unavailable");data=await response.json();frozenRaceCases.set(key,data);}
    if(request!==raceCaseRequest)return;
    frozenRace=data;$("race-cutoff").value="";renderRaceReplay();
  }catch(_){if(request===raceCaseRequest){frozenRaceFailed=true;renderRaceReplay();}}
}
selectRaceExample("9213");
$("race-demo-case").addEventListener("change",()=>selectRaceExample($("race-demo-case").value));
$("open-race-demo").addEventListener("click",()=>{setAnalysisTab("strategy");renderRaceReplay();$("panel-strategy").scrollIntoView({behavior:"smooth"});});
