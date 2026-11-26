import {createClient, AnamEvent} from '@anam-ai/js-sdk';
import {getContext} from '../../../extensions.js';

const id = 'astra-anam';
const el = suffix => document.getElementById(`${id}-${suffix}`);
const status = text => { el('status').textContent = text; };
let client=null, owner=null, connecting=false, epoch=0, audioEpoch=0, leaseId=null;
let stopTimer, hiddenTimer, startupTimer, ttsAudio=null, priorMute=false;
let queue=Promise.resolve(), queuedSeconds=0, stopping=false;
async function api(route, body={}) {
  const r = await fetch('/astra-anam/' + route, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json', 'X-Astra-Anam':'1'}, body:JSON.stringify(body), signal:AbortSignal.timeout(25000)});
  const data = await r.json();
  if (!r.ok) throw Error(data.error || 'Anam service unavailable');
  return data;
}
function current() {
  const c=getContext();
  if(c.groupId || c.characterId === undefined || c.characterId === null) throw Error('Open a single companion chat first.');
  const a=c.characters[c.characterId];
  if(!a?.avatar) throw Error('Select a companion.');
  return {avatar:a.avatar, name:a.name, chatId:c.chatId};
}
async function guarded(fn) { try { await fn(); } catch(e) { status(e.message || 'Request failed.'); } }
async function refresh() {
  const c=current(), d=await api('status');
  if (current().avatar !== c.avatar) return;
  el('companion').textContent=c.name;
  el('assigned').textContent=d.faces[c.avatar]?.name || 'No avatar assigned';
  el('face').value=d.faces[c.avatar]?.id || (c.name === 'Astra' ? d.suggestedAstraId : '');
  el('key').placeholder=d.configured ? 'Key saved privately on server' : 'Paste Anam API key here';
}
function applyMute() { el('video').muted=el('muted').checked; el('video').volume=el('muted').checked ? 0 : 1; }
function muteTts() {
  const a=document.getElementById('tts_audio');
  if (a && a !== ttsAudio) { ttsAudio=a; priorMute=a.muted; }
  if (ttsAudio) ttsAudio.muted=true;
}
async function stop(reason='Stopped. No Anam preview running.') {
  if(stopping) return;
  ++epoch; ++audioEpoch; connecting=false; stopping=true;
  clearTimeout(stopTimer); clearTimeout(hiddenTimer); clearTimeout(startupTimer);
  const old=client, oldLease=leaseId; client=null; owner=null; leaseId=null;
  queue=Promise.resolve(); queuedSeconds=0;
  el('video').muted=true; el('video').volume=0; el('video').srcObject=null;
  status(reason);
  if(old) { try { await old.stopStreaming(); } catch {} }
  if(oldLease) { try { await api('release', {leaseId:oldLease}); } catch {} }
  if(ttsAudio) { ttsAudio.pause(); ttsAudio.muted=priorMute; ttsAudio=null; }
  stopping=false; el('start').disabled=false;
}
async function start() {
  if(client || connecting || stopping) return;
  if (document.getElementById('astra-simli-start')?.disabled) throw Error('Stop the Simli preview before starting Anam.');
  if (document.hidden) throw Error('Keep this tab open to start the preview.');
  const who=current(), run=++epoch;
  connecting=true; el('start').disabled=true; el('muted').checked=true; applyMute(); muteTts();
  status('Connecting silently…');
  try {
    const token=await api('token', {avatar:who.avatar});
    if(run !== epoch) { await api('release', {leaseId:token.leaseId}); return; }
    leaseId=token.leaseId;
    const c=createClient(token.sessionToken, {disableInputAudio:true, metrics:{disableClientMetrics:true}});
    client=c; owner=who;
    c.addListener(AnamEvent.CONNECTION_CLOSED, () => { if(client===c) void stop('Anam session ended. Start again when ready.'); });
    c.addListener(AnamEvent.VIDEO_STREAM_STARTED, applyMute);
    c.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
      if(client !== c) return;
      clearTimeout(startupTimer); connecting=false; applyMute();
      status('Connected silently. Use Narrate in this companion’s chat when ready. Untick Mute for sound.');
    });
    stopTimer=setTimeout(() => { if(client===c) void stop('Three-minute preview ended.'); }, token.maxSeconds*1000);
    startupTimer=setTimeout(() => { if(client===c && connecting) void stop('Connection timed out. Please retry.'); },45000);
    await c.streamToVideoElement(`${id}-video`);
    applyMute();
    if(run!==epoch) { try { await c.stopStreaming(); } catch {} }
  } catch(e) { if(run===epoch) { await stop(); throw e; } }
}
async function pcm(audio) {
  const blob=audio instanceof Blob ? audio : await fetch(audio).then(r => { if(!r.ok) throw Error('Cannot read the TTS audio.'); return r.blob(); });
  if(blob.size>15e6) throw Error('Use a shorter Narrate message.');
  const decoder=new OfflineAudioContext(1,1,24000);
  const decoded=await decoder.decodeAudioData(await blob.arrayBuffer());
  if(decoded.duration>90) throw Error('Use a message under 90 seconds for this preview.');
  const ctx=new OfflineAudioContext(1,Math.max(1,Math.ceil(decoded.duration*24000)),24000);
  const source=ctx.createBufferSource(); source.buffer=decoded; source.connect(ctx.destination); source.start();
  const samples=(await ctx.startRendering()).getChannelData(0);
  const bytes=new Uint8Array(samples.length*2), view=new DataView(bytes.buffer);
  for(let i=0;i<samples.length;i++) view.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
  return bytes;
}
function onAudio(data) {
  if(!client || connecting || !owner || data.characterName!==owner.name) return;
  muteTts();
  const c=client, run=epoch, turn=audioEpoch;
  queue=queue.then(async() => {
    if(client!==c || run!==epoch || turn!==audioEpoch) return;
    const bytes=await pcm(data.audio);
    if(client!==c || run!==epoch || turn!==audioEpoch) return;
    queuedSeconds+=bytes.length/48000;
    if(queuedSeconds>150) throw Error('Preview audio limit reached. Stop and start another preview.');
    const stream=c.createAgentAudioInputStream({encoding:'pcm_s16le',sampleRate:24000,channels:1});
    status(el('muted').checked ? 'Animating Narrate audio · sound muted' : 'Animating Narrate audio');
    // Pace input approximately in real time so long replies cannot flood the socket.
    for(let p=0;p<bytes.length;p+=12000) {
      if(client!==c || run!==epoch || turn!==audioEpoch) return;
      stream.sendAudioChunk(bytes.subarray(p,p+12000));
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(client===c && run===epoch && turn===audioEpoch) stream.endSequence();
  }).catch(e=> { if(client===c && run===epoch) void stop('Audio bridge: '+e.message); });
}
function init() {
  if(document.getElementById(id)) return;
  const box=document.createElement('div'); box.id=id; box.className='extension_container';
  box.innerHTML=`<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Companion Avatar · Anam</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content">
  <p>Current companion: <b id="${id}-companion"></b><br>Assigned avatar: <span id="${id}-assigned">Loading…</span></p>
  <label>Anam avatar ID<input id="${id}-face" class="text_pole" autocomplete="off" spellcheck="false"></label>
  <label>Anam API key (saved privately on your server)<input type="password" id="${id}-key" class="text_pole" autocomplete="off"></label>
  <button type="button" id="${id}-savekey" class="menu_button">Save key &amp; assign avatar</button>
  <button type="button" id="${id}-assign" class="menu_button">Assign using saved key</button>
  <p>Saving does not start a session. Start uses Anam minutes, including silence. Preview ends after three minutes, on chat change, or after 30 seconds in the background. No microphone or camera is requested.</p>
  <button type="button" id="${id}-start" class="menu_button">Start silent preview</button><button type="button" id="${id}-stop" class="menu_button">Stop</button>
  <label class="checkbox_label"><input type="checkbox" id="${id}-muted" checked>Mute avatar sound</label>
  <video id="${id}-video" autoplay playsinline muted style="width:100%;max-height:420px;object-fit:contain;background:#111;border-radius:10px"></video>
  <p id="${id}-status" role="status">Not connected. Uses this companion’s existing SillyTavern Narrate voice.</p></div></div>`;
  document.querySelector('#extensions_settings2,#extensions_settings').append(box);
  el('savekey').onclick=()=>guarded(async()=>{
    const who=current(), apiKey=el('key').value; el('key').value='';
    await api('setup',{avatar:who.avatar,faceId:el('face').value.trim(),apiKey});
    await refresh(); status('Key saved privately and avatar assigned. No session started.');
  });
  el('assign').onclick=()=>guarded(async()=>{ const who=current(); await api('assign',{avatar:who.avatar,faceId:el('face').value.trim()}); await refresh(); status('Avatar assigned. No session started.'); });
  el('start').onclick=()=>guarded(start); el('stop').onclick=()=>void stop();
  el('muted').onchange=()=> { applyMute(); if(!el('muted').checked && client) void el('video').play().catch(()=>status('Tap the video to enable playback.')); };
  el('video').onclick=()=> { if(client) void el('video').play().catch(()=>status('Playback blocked by the browser.')); };
  const {eventSource,eventTypes}=getContext();
  eventSource.on(eventTypes.TTS_AUDIO_READY,onAudio);
  eventSource.on(eventTypes.CHAT_CHANGED,()=> { void stop('Chat changed. Start Anam when ready.'); void guarded(refresh); });
  eventSource.on(eventTypes.GENERATION_STARTED,()=> { ++audioEpoch; if(client&&!connecting) try { client.interruptPersona(); } catch {} });
  document.addEventListener('visibilitychange',()=> { clearTimeout(hiddenTimer); if(document.hidden && (client||connecting)) hiddenTimer=setTimeout(()=>void stop('Stopped after 30 seconds in the background.'),30000); });
  window.addEventListener('pagehide',()=>void stop());
  void guarded(refresh);
}
jQuery(init);
