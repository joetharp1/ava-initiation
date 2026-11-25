import {SimliClient,LogLevel} from 'simli-client';
import {getContext} from '../../../extensions.js';

const id='astra-simli';
let client=null,owner=null,connecting=false,epoch=0,stopTimer=null,hiddenTimer=null,priorMute=false,ttsAudio=null,queue=Promise.resolve();
const $id=s=>document.getElementById(id+'-'+s);
const status=s=>{$id('status').textContent=s;};
async function api(route,body={}){const r=await fetch('/astra-avatar/'+route,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Astra-Avatar':'1'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Avatar service unavailable');return d;}
function current(){const c=getContext();if(c.groupId||c.characterId===undefined||c.characterId===null)throw Error('Open a single companion chat first.');const a=c.characters[c.characterId];if(!a?.avatar)throw Error('Select a companion.');return {avatar:a.avatar,name:a.name,chatId:c.chatId};}
async function guarded(fn){try{await fn();}catch(e){status(e.message||String(e));}}
function faceOptions(faces){const s=$id('face');s.replaceChildren();for(const f of faces){const o=document.createElement('option');o.value=f.id;o.textContent=f.name+' · '+f.id.slice(0,8);s.append(o);}}
async function refresh(){const c=current(),d=await api('status');$id('companion').textContent=c.name;$id('assigned').textContent=d.faces[c.avatar]?.name||'No face assigned';$id('key').placeholder=d.configured?'Key saved privately on server':'Paste Simli API key here';}
function restoreAudio(){if(ttsAudio){ttsAudio.muted=priorMute;ttsAudio=null;}}
async function stop(reason='Stopped. No avatar session running.'){
 ++epoch;connecting=false;clearTimeout(stopTimer);clearTimeout(hiddenTimer);const old=client;client=null;owner=null;queue=Promise.resolve();restoreAudio();$id('start').disabled=false;
 if(old){try{await old.stop();}catch{}try{await old.audioContext?.close();}catch{}}
 $id('video').srcObject=null;$id('audio').srcObject=null;status(reason);
}
async function start(){
 if(client||connecting)return;const who=current();connecting=true;const run=++epoch;$id('start').disabled=true;$id('muted').checked=true;$id('audio').volume=0;$id('audio').muted=true;$id('video').volume=0;$id('video').muted=true;
 status('Connecting silently…');
 try{
  const {session_token}=await api('token',{avatar:who.avatar});if(run!==epoch)return;
  ttsAudio=document.getElementById('tts_audio');if(ttsAudio){priorMute=ttsAudio.muted;ttsAudio.muted=true;}
  const c=new SimliClient(session_token,$id('video'),$id('audio'),null,LogLevel.ERROR,'livekit');client=c;owner=who;
  c.on('stop',()=>{if(client===c)void stop('Session ended. Press Start to reconnect.');});
  c.on('error',()=>{if(client===c)void stop('Simli ended the session. Check account minutes or retry.');});
  c.on('speaking',()=>{if(client===c)status($id('muted').checked?who.name+' is speaking · sound muted':'Avatar speaking');});
  c.on('silent',()=>{if(client===c)status('Connected · waiting for this companion’s TTS audio');});
  stopTimer=setTimeout(()=>void stop('Five-minute preview ended.'),300000);
  const startup=setTimeout(()=>{if(connecting&&client===c)void stop('Connection timed out. Press Start to retry.');},45000);
  try{await c.start();}finally{clearTimeout(startup);}
  if(run!==epoch){try{await c.stop();}catch{}return;}
  connecting=false;status('Connected silently. Use ST’s Narrate action when ready; sound stays muted until you untick Mute.');
 }catch(e){if(run===epoch){await stop();throw e;}}
}
async function pcm(audio){
 const blob=audio instanceof Blob?audio:await fetch(audio).then(r=>{if(!r.ok)throw Error('Could not read TTS audio');return r.blob();});
 if(blob.size>15e6)throw Error('Audio is too large for this preview.');
 const ctx=new OfflineAudioContext(1,1,16000),decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
 if(decoded.duration>120)throw Error('Use a shorter voice message for the avatar preview (under two minutes).');
 const out=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000),src=out.createBufferSource();src.buffer=decoded;src.connect(out.destination);src.start();
 const mono=(await out.startRendering()).getChannelData(0),bytes=new Uint8Array(mono.length*2),v=new DataView(bytes.buffer);
 for(let i=0;i<mono.length;i++)v.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,mono[i]))*32767),true);return bytes;
}
function onAudio(data){
 if(!client||connecting||!owner||data.characterName!==owner.name)return;
 const c=client,run=epoch;queue=queue.then(async()=>{
  if(client!==c||run!==epoch)return;const bytes=await pcm(data.audio);if(client!==c||run!==epoch)return;
  for(let p=0;p<bytes.length;p+=32000){if(client!==c||run!==epoch)return;c.sendAudioData(bytes.subarray(p,p+32000));}
 }).catch(e=>status('Audio bridge: '+e.message));
}
function init(){
 if(document.getElementById(id))return;
 const box=document.createElement('div');box.id=id;box.className='extension_container';
 box.innerHTML=`<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Companion Avatar · Simli</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content">
 <p>Current companion: <b id="${id}-companion"></b><br>Assigned face: <span id="${id}-assigned">Loading…</span></p>
 <label>Simli API key (saved privately on your server)<input type="password" id="${id}-key" class="text_pole" autocomplete="off"></label>
 <button type="button" id="${id}-savekey" class="menu_button">Save key &amp; load faces</button><button type="button" id="${id}-load" class="menu_button">Load my faces</button>
 <select id="${id}-face" class="text_pole"></select><button type="button" id="${id}-assign" class="menu_button">Assign to this companion</button>
 <p>Start uses Simli minutes. Preview stops after five minutes, changing chats, or one minute with this tab hidden. No microphone is requested.</p>
 <button type="button" id="${id}-start" class="menu_button">Start silent preview</button><button type="button" id="${id}-stop" class="menu_button">Stop</button>
 <label class="checkbox_label"><input type="checkbox" id="${id}-muted" checked>Mute avatar sound</label>
 <video id="${id}-video" autoplay playsinline muted style="width:100%;max-height:360px;object-fit:contain;background:#111;border-radius:10px"></video><audio id="${id}-audio" autoplay muted></audio>
 <p id="${id}-status" role="status">Not connected. Existing ST TTS audio will animate only the selected companion while a session is running.</p></div></div>`;
 document.querySelector('#extensions_settings2,#extensions_settings').append(box);
 $id('savekey').onclick=()=>guarded(async()=>{const input=$id('key'),key=input.value;input.value='';const r=await api('key',{apiKey:key});faceOptions(r.faces);await refresh();status('Key saved. Choose Mollie’s face and assign it.');});
 $id('load').onclick=()=>guarded(async()=>{faceOptions((await api('faces')).faces);await refresh();status('Faces loaded.');});
 $id('assign').onclick=()=>guarded(async()=>{const c=current();await api('assign',{avatar:c.avatar,faceId:$id('face').value});await refresh();status('Face assigned to '+c.name+'.');});
 $id('audio').volume=0;$id('video').volume=0;
 $id('start').onclick=()=>guarded(start);$id('stop').onclick=()=>void stop();$id('muted').onchange=()=>{$id('audio').volume=$id('muted').checked?0:1;$id('audio').muted=$id('muted').checked;};
 const {eventSource,eventTypes}=getContext();eventSource.on(eventTypes.TTS_AUDIO_READY,onAudio);
 eventSource.on(eventTypes.CHAT_CHANGED,()=>{void stop('Chat changed. Start the avatar when ready.');void guarded(refresh);});
 eventSource.on(eventTypes.GENERATION_STARTED,()=>{if(client&&!connecting)try{client.ClearBuffer();}catch{}});
 document.addEventListener('visibilitychange',()=>{clearTimeout(hiddenTimer);if(document.hidden&&client)hiddenTimer=setTimeout(()=>void stop('Stopped after one minute in the background.'),60000);});
 window.addEventListener('pagehide',()=>{void stop();});void guarded(refresh);
}
jQuery(init);
