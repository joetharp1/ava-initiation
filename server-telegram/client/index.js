import * as host from '../../../../script.js';
import {getContext} from '../../../extensions.js';
import {createGenerationParameters,getChatCompletionModel,oai_settings} from '../../../openai.js';

const BASE='/astra-initiation';
let busy=false,refreshTimer=null,lastStatus=null,lastActivity=0;
const encoder=new TextEncoder();
async function signature(rows){const value=JSON.stringify(rows.filter(m=>typeof m?.mes==='string').map(m=>[!!m.is_user,!!m.is_system,m.mes,m.extra?.media?.map(p=>p.url)||[],m.extra?.tool_invocations||[]]));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function current(){const c=getContext();if(c.groupId||c.characterId==null||!c.chatId)throw new Error('Open an individual companion chat first.');const character=c.characters[c.characterId];if(!character?.avatar)throw new Error('No companion selected.');return {c,avatar:character.avatar,chatId:c.chatId,name:c.name2};}
function same(t){try{const a=current();return a.avatar===t.avatar&&a.chatId===t.chatId&&a.c.chat===t.c.chat;}catch{return false;}}
function identity(t){return {avatar:t.avatar,chatId:t.chatId};}
async function api(route,body={}){
    const response=await fetch(BASE+route,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Astra-Initiation':'1'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    if(!response.ok){let data={};try{data=await response.json();}catch{}throw new Error(data.error||`Server initiation: HTTP ${response.status}`);}
    return response.json();
}
const panel=document.createElement('div');panel.id='astra-server-initiation';panel.className='inline-drawer';
panel.innerHTML=`<div class="inline-drawer-toggle inline-drawer-header"><b>Server Initiation · Telegram</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
<div class="inline-drawer-content"><p>Messages run on your server, even with SillyTavern closed. Enable each companion chat separately.</p>
<button type="button" class="menu_button" data-action="enable">Enable this chat</button>
<button type="button" class="menu_button" data-action="refresh">Refresh context</button>
<button type="button" class="menu_button" data-action="test">Test in 60 seconds</button>
<button type="button" class="menu_button" data-action="import">Collect pending message</button>
<button type="button" class="menu_button" data-action="pause">Pause this chat</button>
<button type="button" class="menu_button" data-action="status">Check status</button>
<p data-status role="status" style="white-space:pre-wrap;overflow-wrap:anywhere">Checking server…</p>
<small>Text only · one unanswered initiation per chat · maximum 3 per day · existing interval and quiet-hour settings · Europe/London.<br>Telegram carries the message. Its saved inbox copy is imported into this chat when you return. Reply in SillyTavern; Telegram replies are not connected yet.</small></div>`;
const out=panel.querySelector('[data-status]');
function say(text){out.textContent=text;}
function stateFor(t){return lastStatus?.targets.find(x=>x.avatar===t.avatar&&x.chatId===t.chatId);}
async function status(){
    lastStatus=await api('/status');let t;try{t=stateFor(current());}catch{}
    if(!t){say('Server connected. Open the companion chat you want, then Enable this chat.');return;}
    const date=n=>new Date(n).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    say(`${t.name}: ${t.enabled?'enabled':'paused'}\n${t.job?'Generating one message…':t.pending?`Telegram: ${t.pending.telegramState}. Chat: ${t.pending.imported?'saved and verified':'waiting to import'}.`:t.awaitingReply?'Waiting for your next completed exchange.':`Next check: ${date(t.nextAt)} (${t.min}–${t.max} minute interval).`}\n${t.lastError||''}`);
}
async function activity(){if(Date.now()-lastActivity<10000)return;lastActivity=Date.now();try{await api('/activity');}catch{}}
function occupied(){return host.isGenerating()||String(document.getElementById('send_textarea')?.value||'').trim();}
async function snapshot(enable=false){
    const t=current();if(occupied())throw new Error('Finish the current reply and leave the message box empty first.');
    const baseline=await api('/baseline',identity(t));
    if(await signature(t.c.chat)!==baseline.signature)throw new Error('This tab and the saved chat differ. Reload the chat first.');
    let prompt=null;
    const listener=(data,dry)=>{if(dry&&same(t)&&Array.isArray(data.prompt))prompt=structuredClone(data.prompt);};
    host.eventSource.makeLast(host.event_types.GENERATE_AFTER_DATA,listener);
    say('Preparing this companion’s SillyTavern context. No model reply is being requested…');
    try{await host.Generate('normal',{automatic_trigger:true},true);}finally{host.eventSource.removeListener(host.event_types.GENERATE_AFTER_DATA,listener);}
    if(!same(t)||occupied())throw new Error('Chat changed while preparing context. Nothing was armed.');
    if(!prompt?.length)throw new Error('SillyTavern did not return its assembled prompt.');
    const cfg={...oai_settings,function_calling:false,stream_openai:false,n:1,openai_max_tokens:700,enable_web_search:false,request_images:false};
    const {generate_data}=await createGenerationParameters(cfg,getChatCompletionModel(cfg),'quiet',prompt);
    // Run the same request adapters (including Venice image compatibility) as normal chat.
    await host.eventSource.emit(host.event_types.CHAT_COMPLETION_SETTINGS_READY,generate_data);
    generate_data.stream=false;generate_data.n=1;generate_data.max_tokens=700;
    delete generate_data.tools;delete generate_data.tool_choice;delete generate_data.parallel_tool_calls;delete generate_data.json_schema;
    if(!same(t)||occupied())throw new Error('Chat activity changed before context was saved.');
    await api('/snapshot',{...identity(t),name:t.name,...baseline,signature:await signature(t.c.chat),params:generate_data,enable});
    await status();
}
async function collect(){
    const t=current();if(occupied())return;
    const inbox=await api('/inbox',identity(t));if(!inbox.pending)return;
    if(!same(t))return;
    const p=inbox.pending;
    if(t.c.chat.some(m=>m.extra?.server_initiation?.id===p.id)){await api('/ack',{...identity(t),id:p.id});await status();return;}
    if(await signature(t.c.chat)!==p.baseSignature){say(`${t.name} has a message in the server inbox. Your conversation has moved on; use Collect pending message to add it after the current exchange.`);return {needsManual:true,pending:p};}
    await importPending(t,p);
}
async function importPending(t,p){
    if(!same(t)||occupied())throw new Error('Finish the current message before collecting.');
    const claim=await api('/claim',{...identity(t),id:p.id,signature:await signature(t.c.chat)});
    if(claim.alreadySaved){await t.c.reloadCurrentChat();await api('/ack',{...identity(t),id:p.id});return;}
    if(!same(t)||occupied())throw new Error('Chat changed before import; inbox copy retained.');
    const textarea=document.getElementById('send_textarea'),wasDisabled=textarea?.disabled;
    if(textarea)textarea.disabled=true;
    const message={name:t.name,is_user:false,is_system:false,send_date:new Date(p.createdAt).toISOString(),mes:p.text,extra:{server_initiation:{id:p.id,createdAt:p.createdAt,source:'telegram-server'}}};
    try{
        // No server-side whole-chat writes: use ST's normal save from the active, verified tab.
        t.c.chat.push(message);host.addOneMessage(message);
        await t.c.saveChat();
        await api('/ack',{...identity(t),id:p.id,lease:claim.lease});
        // Text is already delivered; don't trigger photo/video continuation or automatic TTS.
        say(`${t.name}’s Telegram message is saved and verified in this chat.`);
    }finally{if(textarea)textarea.disabled=wasDisabled;}
    await status();
}
async function guarded(fn){
    if(busy)return;busy=true;
    const action=async()=>{try{await fn();}catch(e){say(e.message);console.warn('[Server Initiation]',e.message);}finally{busy=false;}};
    if(navigator.locks)await navigator.locks.request('astra-server-initiation',{ifAvailable:true},async lock=>{if(lock)await action();else{busy=false;say('Another tab is preparing or importing context.');}});else await action();
}
panel.addEventListener('click',event=>{
    const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
    guarded(async()=>{
        if(action==='status')return status();
        if(action==='pause'){await api('/pause',identity(current()));return status();}
        if(action==='import'){const t=current(),result=await collect();if(result?.needsManual)await importPending(t,result.pending);return status();}
        await collect();
        if(action==='enable')return snapshot(true);
        if(action==='refresh')return snapshot(false);
        if(action==='test'){await snapshot(false);await api('/test',identity(current()));await status();say('Server test armed for 60 seconds. Close SillyTavern now and watch Telegram. Allow up to three minutes for generation and delivery.');}
    });
});
function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>guarded(async()=>{
    if(document.hidden||occupied())return;await status();await collect();const t=current();const s=stateFor(t);
    if(s?.enabled&&!s.job&&(!s.pending||s.pending.imported))await snapshot(false);
}),3000);}
host.eventSource.on(host.event_types.CHAT_CHANGED,()=>{schedule();});
host.eventSource.on(host.event_types.GENERATION_STARTED,(type,options,dry)=>{if(!dry)activity();});
host.eventSource.on(host.event_types.GENERATION_ENDED,schedule);
host.eventSource.on(host.event_types.MESSAGE_SENT,()=>{activity();schedule();});
document.getElementById('send_textarea')?.addEventListener('input',activity);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)guarded(async()=>{await status();await collect();});});
setInterval(()=>{if(!document.hidden&&!busy)guarded(async()=>{await status();await collect();});},20000);
document.getElementById('extensions_settings')?.appendChild(panel);
status().catch(e=>say(e.message));
