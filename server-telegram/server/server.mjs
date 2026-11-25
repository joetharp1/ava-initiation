import fs from 'node:fs';
import {imageSettings,generateStill} from './images.mjs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {hash,signature,targetId,safeName,readChat,sourceFingerprint,atomicWrite,eligible,repeatText,validateSnapshot,initiationInstruction,rowKeys,appendOnlyDelta,recoverRowKeys,parseInitiation,hasToolMarkup,visibleInitiationText} from './core.mjs';

const ROOT=process.env.ST_DATA_ROOT||'/st-data/default-user';
const STATE=process.env.STATE_ROOT||'/state';
const STATE_FILE=path.join(STATE,'state.json');
const BASE='/astra-initiation';
const ST_URL=process.env.ST_URL||'http://sillytavern:8000';
const ORIGIN=process.env.PUBLIC_ORIGIN;
process.env.ST_USER ||= process.env.ADMIN_USERNAME;
process.env.ST_PASSWORD ||= process.env.ADMIN_PASSWORD;
const AUTH='Basic '+Buffer.from(`${process.env.ST_USER}:${process.env.ST_PASSWORD}`).toString('base64');
const require=createRequire(process.env.NODE_ENV==='test'?import.meta.url:'/home/node/app/package.json');
const YAML=require('yaml');
const telegramRoot=process.env.NODE_ENV==='test'?'http://127.0.0.1:'+process.env.TEST_TELEGRAM_PORT:'https://api.telegram.org';
if(!process.env.ST_USER||!process.env.ST_PASSWORD||!ORIGIN)throw new Error('Server authentication is not configured');
fs.mkdirSync(STATE,{recursive:true,mode:0o700});
let state=fs.existsSync(STATE_FILE)?JSON.parse(fs.readFileSync(STATE_FILE,'utf8')):{version:1,targets:{},events:[]};
const save=()=>atomicWrite(STATE_FILE,state);
function event(type,id,detail='') {state.events.push({at:new Date().toISOString(),type,id,detail:String(detail).slice(0,300)});state.events=state.events.slice(-100);save();console.log(JSON.stringify({type,id,detail}));}
if(state.version<2 && fs.existsSync(STATE_FILE)) fs.copyFileSync(STATE_FILE,STATE_FILE+'.pre-v2-'+Date.now());
for(const t of Object.values(state.targets)){
    t.queue ||= t.pending?[t.pending]:[];
    for(const p of t.queue){
        if(p.telegramState==='sending')p.telegramState='unknown';
        if(p.imageState==='generating')p.imageState='unknown';
    }
    if(t.job){t.lastError='An interrupted attempt was not repeated.';t.job=null;}
    if(state.version<2 && t.snapshot){
        const chat=readChat(ROOT,t.avatar,t.chatId);
        t.snapshot.rowKeys=recoverRowKeys(t.snapshot,chat);
        t.snapshot.sourceHash=sourceFingerprint(ROOT,t.avatar);
        if(t.snapshot.rowKeys)t.lastError=null;
        t.nextAt=Date.now()+(60+Math.random()*240)*1000;
    }
    t.awaitingReply=false;t.lease=null;t.pending=t.queue.find(p=>!p.imported)||null;
}
state.version=2;
save();
let running=false;
let browserActivity=0;
const settings=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'settings.json'),'utf8'));
function publicTarget(t){const p=t.queue.find(p=>!p.imported);let contextReady=false;try{contextReady=current(t);}catch{}
return {id:t.id,avatar:t.avatar,chatId:t.chatId,name:t.name,enabled:t.enabled,nextAt:t.nextAt,quietStart:t.quietStart,quietEnd:t.quietEnd,min:t.min,max:t.max,awaitingReply:false,job:t.job?{id:t.job.id,stage:t.job.stage}:null,pending:p?{id:p.id,createdAt:p.createdAt,telegramState:p.telegramState,imported:false}:null,pendingCount:t.queue.filter(p=>!p.imported).length,imagesEnabled:!!imageConfig(t),snapshotAt:t.snapshot?.createdAt,contextReady,lastError:t.lastError||null};}
const getTarget=b=>{const id=targetId(b.avatar,b.chatId);const t=state.targets[id];if(!t)throw new Error('This chat has not been enabled.');return t;};
function readFor(t){return readChat(ROOT,t.avatar,t.chatId);}
function baseline(avatar,chatId){const c=readChat(ROOT,avatar,chatId);return {signature:c.signature,chatHash:c.hash,sourceHash:sourceFingerprint(ROOT,avatar)};}
function nextDelay(t){return (t.min+Math.random()*(t.max-t.min))*60000;}
function activityBlocks(t){return t.test?browserActivity>(t.testArmedAt||0):browserActivity>Date.now()-90000;}
function current(t){if(!t.snapshot)return false;try{appendOnlyDelta(t.snapshot,readFor(t));return sourceFingerprint(ROOT,t.avatar)===t.snapshot.sourceHash;}catch{return false;}}
async function stRequest(route,body,timeout=90000){
    const tokenReply=await fetch(ST_URL+'/csrf-token',{headers:{Authorization:AUTH},signal:AbortSignal.timeout(10000)});
    if(!tokenReply.ok)throw new Error('SillyTavern authentication failed: HTTP '+tokenReply.status);
    const csrf=(await tokenReply.json()).token;
    const cookie=tokenReply.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    const response=await fetch(ST_URL+route,{method:'POST',headers:{Authorization:AUTH,'Content-Type':'application/json','X-CSRF-Token':csrf,Cookie:cookie},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
    if(!response.ok)throw new Error('SillyTavern generation returned HTTP '+response.status);
    const data=await response.json();
    if(data.error)throw new Error('The model provider rejected the request. Check the selected model/credit in SillyTavern.');
    return data;
}
function imageConfig(t){return imageSettings(settings(),t.avatar);}
async function makeImage(t,p,prompt){
    if(!imageConfig(t))return;
    const url=await generateStill({root:ROOT,origin:ORIGIN,auth:AUTH,avatar:t.avatar,prompt,settings:settings(),
        reserve:price=>{if(!t.enabled)throw Error('Paused');p.imageState='generating';p.imageCostUsd=price;p.imageStartedAt=Date.now();save();},
        upload:async image=>{const r=await stRequest('/api/images/upload',{image:image.base64,format:image.extension,ch_name:t.name,filename:'initiation_'+p.id});
            if(typeof r.path!=='string'||!r.path.startsWith('user/images/')&&!r.path.startsWith('/user/images/'))throw Error('Invalid saved image path.');return r.path;}});
    p.imageUrl=url;p.imageState='ready';save();
}
async function notify(t,p){
    if(hasToolMarkup(p.text)){p.telegramState='withheld';save();throw Error('Raw model command withheld from Telegram.');}
    const a=settings().extension_settings?.['ava-initiation'];
    if(!a?.telegramToken||!a?.telegramChatId){p.telegramState='failed';save();throw new Error('Telegram configuration is missing.');}
    p.telegramState='sending';save();
    let response;
    try{
        response=await fetch(telegramRoot+'/bot'+a.telegramToken+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:a.telegramChatId,text:`${t.name}\n\n${p.text}`.slice(0,3900),disable_notification:false,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(15000)});
    }catch{p.telegramState='unknown';save();throw new Error('Telegram outcome unknown; no automatic retry to avoid duplicate messages.');}
    const data=await response.json();
    if(!response.ok||!data.ok){p.telegramState='failed';save();throw new Error('Telegram rejected delivery: HTTP '+response.status+'. Check the bot in the existing initiation settings.');}
    p.telegramState='sent';p.telegramMessageId=data.result?.message_id;save();
    event('telegram-delivered',t.id,'Message saved in the server inbox; awaiting chat import.');
}
async function run(t){
    if(running)return;
    running=true;
    const id=crypto.randomUUID();
    try{
        if(!current(t)){t.lastError='Character or existing history changed. Open this chat to refresh context.';t.nextAt=Date.now()+60000;save();return;}
        if(activityBlocks(t)){t.nextAt=Date.now()+120000;save();return;}
        const chat=readFor(t),last=chat.rows.filter(m=>!m.is_system).at(-1);
        if(last?.is_user){t.lastError='Waiting for the current conversation to finish.';t.nextAt=Date.now()+60000;save();return;}
        t.job={id,stage:'generating',startedAt:Date.now()};t.lastError=null;save();
        event('generation-started',t.id,'One model request; no retries.');
        const request=structuredClone(t.snapshot.params);
        const delta=appendOnlyDelta(t.snapshot,chat);
        for(const m of delta){if(m.mes&&!m.is_system)request.messages.push({role:m.is_user?'user':'assistant',content:m.mes});}
        const outstanding=t.queue.filter(p=>!chat.rows.some(m=>m.extra?.server_initiation?.id===p.id));
        for(const p of outstanding.slice(-30))request.messages.push({role:'assistant',content:p.text});
        request.messages.push({role:'user',content:initiationInstruction(t.name,settings().username||'Joe',Date.now(),outstanding.at(-1)?.text||last.mes,!!imageConfig(t))});
        request.stream=false;request.n=1;request.max_tokens=700;
        delete request.tools;delete request.tool_choice;delete request.parallel_tool_calls;delete request.json_schema;
        request.enable_web_search=false;request.request_images=false;
        // Preserve the configured custom connection body, but bound this job's output/work.
        const extra=YAML.parse(request.custom_include_body||'{}')||{};
        delete extra.tools;delete extra.tool_choice;delete extra.parallel_tool_calls;
        extra.stream=false;extra.n=1;extra.max_tokens=700;
        extra.venice_parameters={...(extra.venice_parameters||{}),include_venice_system_prompt:false,enable_web_search:'off',enable_web_scraping:false};
        request.custom_include_body=JSON.stringify(extra);
        // Exclusions must not remove this background job's safety bounds.
        const excluded=YAML.parse(request.custom_exclude_body||'[]');
        if(Array.isArray(excluded))request.custom_exclude_body=JSON.stringify(excluded.filter(k=>!['stream','n','max_tokens','messages','model'].includes(k)));
        const result=await stRequest('/api/backends/chat-completions/generate',request);
        const message=result.choices?.[0]?.message;
        const {text,imagePrompt,imageOnly=false}=parseInitiation(message?.content,message?.tool_calls||[]);
        if(!imageOnly&&(text.length<2||text.length>3500||/<think>|<analysis>/i.test(text)))throw new Error('The model returned an unsuitable notification response.');
        if(text&&repeatText(text,[...chat.rows.filter(m=>!m.is_user&&!m.is_system).slice(-8).map(m=>m.mes),...t.queue.slice(-30).map(p=>p.text)]))throw new Error('Repeated message rejected. No replacement request was made.');
        if(!t.enabled||!current(t)||readFor(t).hash!==chat.hash||activityBlocks(t))throw new Error('Conversation activity changed or initiation was paused while generating; the message was not sent.');
        const p={id,text,createdAt:Date.now(),baseHash:chat.hash,baseSignature:chat.signature,telegramState:'not-sent',imported:false,imageState:'none',imageOnly};
        t.queue.push(p);t.pending=t.queue.find(p=>!p.imported)||null;
        t.awaitingReply=false;t.test=false;t.nextAt=Date.now()+nextDelay(t);
        const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date());
        t.dayCount=t.day===day?(t.dayCount||0)+1:1;t.day=day;
        save(); // Persist before any image request or notification.
        if(imagePrompt){
            t.job.stage='image';save();
            try{await makeImage(t,p,imagePrompt);}catch{p.imageState='failed';t.lastError='Optional image failed; text was retained. No image retry.';save();}
        }
        p.text=visibleInitiationText(p,t.name);t.job=null;save();
        if(t.enabled)await notify(t,p);
    }catch(error){
        t.job=null;t.test=false;t.awaitingReply=false;t.nextAt=Date.now()+nextDelay(t);
        t.lastError=/HTTP|Telegram|Context|Conversation|Repeated|provider|model|SillyTavern|notification/.test(error.message)?error.message:'Initiation stopped; no automatic retry.';
        event('attempt-stopped',t.id,t.lastError);
    }finally{running=false;save();}
}
async function tick(){if(running)return;
    for(const t of Object.values(state.targets)){
        const unsent=t.enabled&&t.queue.find(p=>p.telegramState==='not-sent');
        if(unsent){running=true;try{unsent.text=visibleInitiationText(unsent,t.name);save();await notify(t,unsent);}catch{t.lastError='Telegram delivery failed; no automatic resend.';save();}finally{running=false;}return;}
    }
    for(const t of Object.values(state.targets).sort((a,b)=>a.nextAt-b.nextAt)){if(eligible(t,Date.now())){await run(t);break;}}
}

async function dispatch(route,b){
    if(route==='/status')return {version:'0.2.2',running,targets:Object.values(state.targets).map(publicTarget),events:state.events.slice(-15),telegramConfigured:!!settings().extension_settings?.['ava-initiation']?.telegramToken};
    if(route==='/baseline')return baseline(b.avatar,b.chatId);
    if(route==='/activity'){browserActivity=Date.now();return {ok:true};}
    if(route==='/move'){
        const source=getTarget(b),chatId=safeName(b.toChatId);
        if(chatId===source.chatId)return publicTarget(source);
        if(source.job||source.lease?.expires>Date.now())throw Error('Wait for the running attempt or import to finish before moving chats.');
        readChat(ROOT,source.avatar,chatId); // Same companion directory; destination must exist.
        const id=targetId(source.avatar,chatId);
        let dest=state.targets[id];
        if(dest?.job||dest?.lease?.expires>Date.now())throw Error('The destination chat is busy.');
        if(!dest)dest=state.targets[id]={id,avatar:source.avatar,chatId,name:source.name,min:source.min,max:source.max,quietStart:source.quietStart,quietEnd:source.quietEnd,queue:[],snapshot:null};
        dest.queue ||= [];
        const known=new Set([...dest.queue,...dest.archive||[]].map(p=>p.id));
        for(const p of source.queue.filter(p=>!p.imported))if(!known.has(p.id)){dest.queue.push({...p,movedFrom:source.chatId});known.add(p.id);}
        dest.queue.sort((a,b)=>a.createdAt-b.createdAt);
        source.queue=source.queue.filter(p=>p.imported);source.pending=null;source.enabled=false;source.test=false;source.movedTo=chatId;
        dest.enabled=true;dest.pending=dest.queue.find(p=>!p.imported)||null;dest.awaitingReply=false;dest.test=false;dest.lastError=null;dest.nextAt=Date.now()+nextDelay(dest);
        save();event('chat-binding-moved',dest.id,'Pending receipts moved to the selected chat; source paused.');return publicTarget(dest);
    }
    if(route==='/snapshot'){
        const id=targetId(b.avatar,b.chatId),chat=readChat(ROOT,b.avatar,b.chatId);
        if(b.enable===true&&Object.values(state.targets).some(t=>t.avatar===b.avatar&&t.id!==id&&t.enabled))throw Error('This companion is enabled in another chat. Use this chat instead to move the binding and pending messages.');
        validateSnapshot(b,chat);
        if(b.sourceHash!==sourceFingerprint(ROOT,b.avatar))throw new Error('Character or settings changed while preparing context. Try Refresh context.');
        if(JSON.stringify(b.params).length>8e6)throw new Error('Context is too large.');
        const a=settings().extension_settings?.['ava-initiation']||{};
        let t=state.targets[id];
        if(!t){if(b.enable!==true)throw new Error('Enable this chat first.');t=state.targets[id]={id,avatar:b.avatar,chatId:b.chatId,name:String(b.name).slice(0,100),enabled:true,min:Math.max(15,Number(a.min)||60),max:Math.max(15,Number(a.max)||120),quietStart:a.quietStart||'23:00',quietEnd:a.quietEnd||'08:00'};t.max=Math.max(t.min,t.max);}
        if(t.job)throw new Error('An initiation is already running.');
        t.queue ||= [];
        // Retain every unimported item. Only archive receipts verified in the saved chat.
        const done=t.queue.filter(p=>p.imported&&chat.rows.some(m=>m.extra?.server_initiation?.id===p.id));
        t.archive=[...(t.archive||[]),...done].slice(-50);
        t.queue=t.queue.filter(p=>!done.includes(p));t.pending=t.queue.find(p=>!p.imported)||null;
        const changed=t.snapshot?.chatHash!==chat.hash;
        t.snapshot={params:b.params,chatHash:chat.hash,sourceHash:b.sourceHash,rowKeys:rowKeys(chat.rows),createdAt:Date.now()};
        if(b.enable===true)t.enabled=true;
        t.awaitingReply=false;
        if(!t.nextAt || changed && chat.rows.at(-1)?.is_user)t.nextAt=Date.now()+nextDelay(t);
        t.lastError=null;
        t.test=false;save();return publicTarget(t);
    }
    if(route==='/test'){
        const t=getTarget(b);
        if(t.job)throw new Error('An attempt is already running.');
        if(!t.snapshot||!current(t))throw new Error('Refresh this chat’s server context first.');
        t.enabled=true;t.awaitingReply=false;t.lastError=null;t.test=true;t.testArmedAt=Date.now();t.nextAt=Date.now()+60000;save();event('test-armed',t.id,'One server-owned test in 60 seconds.');return publicTarget(t);
    }
    if(route==='/pause'){const t=getTarget(b);t.enabled=false;t.test=false;save();return publicTarget(t);}
    if(route==='/inbox'){
        const t=state.targets[targetId(b.avatar,b.chatId)];
        const p=t?.queue.find(p=>!p.imported);if(p&&(p.imageState==='generating'||t.job?.id===p.id))return {pending:null};return {pending:p?{...p,name:t.name}:null};
    }
    if(route==='/claim'){
        const t=getTarget(b),p=t.queue.find(p=>p.id===b.id);
        if(!p||p.id!==b.id||p.imported)throw new Error('No pending message.');
        if(t.lease&&t.lease.expires>Date.now())throw new Error('Another tab is importing this message.');
        const chat=readFor(t);
        if(chat.rows.some(m=>m.extra?.server_initiation?.id===p.id))return {alreadySaved:true};
        if(chat.signature!==b.signature)throw new Error('Reload this chat before importing: this tab differs from the server.');
        t.lease={token:crypto.randomUUID(),expires:Date.now()+45000};save();
        return {lease:t.lease.token,pending:{...p,name:t.name}};
    }
    if(route==='/ack'){
        const t=getTarget(b),p=t.queue.find(p=>p.id===b.id);
        if(!p||p.id!==b.id)throw new Error('Pending message not found.');
        const chat=readFor(t);
        if(!chat.rows.some(m=>m.extra?.server_initiation?.id===p.id&&m.mes===p.text&&!m.is_user&&(!p.imageUrl||m.extra?.media?.some(i=>i.url===p.imageUrl))))throw new Error('Chat save is not verified; the inbox copy is retained.');
        p.imported=true;p.importedAt=Date.now();t.pending=t.queue.find(p=>!p.imported)||null;t.lease=null;save();event('chat-import-verified',t.id,'Saved message ID and text verified.');return {ok:true};
    }
    throw new Error('Unknown endpoint.');
}
const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const incoming=Buffer.from(req.headers.authorization||''),expected=Buffer.from(AUTH);
    if(incoming.length!==expected.length||!crypto.timingSafeEqual(incoming,expected)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="SillyTavern"'});res.end();return;}
    if(req.method!=='POST'||req.headers['x-astra-initiation']!=='1'||req.headers.origin&&req.headers.origin!==ORIGIN){res.writeHead(403);res.end();return;}
    const route=new URL(req.url,ORIGIN).pathname.slice(BASE.length);
    if(!req.url.startsWith(BASE+'/')){res.writeHead(404);res.end();return;}
    try{
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>9e6)throw new Error('Request too large');}
        const result=await dispatch(route,JSON.parse(raw||'{}'));
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
    }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message.startsWith('ENOENT')?'Chat or configuration file not found.':e.message}));}
});
server.listen(process.env.NODE_ENV==='test'?Number(process.env.TEST_PORT):8787,'0.0.0.0',()=>console.log('Initiation worker ready; enabled chats: '+Object.values(state.targets).filter(t=>t.enabled).length));
const timer=setInterval(()=>tick().catch(()=>console.log('Scheduler check failed.')),process.env.NODE_ENV==='test'?50:5000);
process.on('SIGTERM',()=>{clearInterval(timer);save();server.close(()=>process.exit(0));});
