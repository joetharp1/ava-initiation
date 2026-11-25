import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {hash,signature,targetId,safeName,readChat,sourceFingerprint,atomicWrite,eligible,repeatText,validateSnapshot,initiationInstruction} from './core.mjs';

const ROOT=process.env.ST_DATA_ROOT||'/st-data/default-user';
const STATE=process.env.STATE_ROOT||'/state';
const STATE_FILE=path.join(STATE,'state.json');
const BASE='/astra-initiation';
const ST_URL=process.env.ST_URL||'http://sillytavern:8000';
const ORIGIN=process.env.PUBLIC_ORIGIN;
const AUTH='Basic '+Buffer.from(`${process.env.ST_USER}:${process.env.ST_PASSWORD}`).toString('base64');
const require=createRequire(process.env.NODE_ENV==='test'?import.meta.url:'/home/node/app/package.json');
const YAML=require('yaml');
const telegramRoot=process.env.NODE_ENV==='test'?'http://127.0.0.1:'+process.env.TEST_TELEGRAM_PORT:'https://api.telegram.org';
if(!process.env.ST_USER||!process.env.ST_PASSWORD||!ORIGIN)throw new Error('Server authentication is not configured');
fs.mkdirSync(STATE,{recursive:true,mode:0o700});
let state=fs.existsSync(STATE_FILE)?JSON.parse(fs.readFileSync(STATE_FILE,'utf8')):{version:1,targets:{},events:[]};
const save=()=>atomicWrite(STATE_FILE,state);
function event(type,id,detail='') {state.events.push({at:new Date().toISOString(),type,id,detail:String(detail).slice(0,300)});state.events=state.events.slice(-100);save();console.log(JSON.stringify({type,id,detail}));}
for(const t of Object.values(state.targets)){
    if(t.job){t.lastError='The worker restarted during an attempt. It will not repeat that request.';t.job=null;t.awaitingReply=true;}
    if(t.pending?.telegramState==='sending')t.pending.telegramState='unknown';
    t.lease=null;
}
save();
let running=false;
let browserActivity=0;
const settings=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'settings.json'),'utf8'));
function publicTarget(t){return {id:t.id,avatar:t.avatar,chatId:t.chatId,name:t.name,enabled:t.enabled,nextAt:t.nextAt,quietStart:t.quietStart,quietEnd:t.quietEnd,min:t.min,max:t.max,awaitingReply:t.awaitingReply,job:t.job?{id:t.job.id,stage:t.job.stage}:null,pending:t.pending?{id:t.pending.id,createdAt:t.pending.createdAt,telegramState:t.pending.telegramState,imported:t.pending.imported}:null,snapshotAt:t.snapshot?.createdAt,lastError:t.lastError||null};}
const getTarget=b=>{const id=targetId(b.avatar,b.chatId);const t=state.targets[id];if(!t)throw new Error('This chat has not been enabled.');return t;};
function readFor(t){return readChat(ROOT,t.avatar,t.chatId);}
function baseline(avatar,chatId){const c=readChat(ROOT,avatar,chatId);return {signature:c.signature,chatHash:c.hash,sourceHash:sourceFingerprint(ROOT,avatar)};}
function nextDelay(t){return (t.min+Math.random()*(t.max-t.min))*60000;}
function activityBlocks(t){return t.test?browserActivity>(t.testArmedAt||0):browserActivity>Date.now()-90000;}
function current(t){return readFor(t).hash===t.snapshot.chatHash && sourceFingerprint(ROOT,t.avatar)===t.snapshot.sourceHash;}
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
async function notify(t){
    const a=settings().extension_settings?.['ava-initiation'];
    if(!a?.telegramToken||!a?.telegramChatId)throw new Error('Telegram token or chat ID is missing from the saved initiation settings.');
    t.pending.telegramState='sending';save();
    let response;
    try{
        response=await fetch(telegramRoot+'/bot'+a.telegramToken+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:a.telegramChatId,text:`${t.name}\n\n${t.pending.text}`.slice(0,3900),disable_notification:false,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(15000)});
    }catch{t.pending.telegramState='unknown';save();throw new Error('Telegram outcome unknown; no automatic retry to avoid duplicate messages.');}
    const data=await response.json();
    if(!response.ok||!data.ok){t.pending.telegramState='failed';save();throw new Error('Telegram rejected delivery: HTTP '+response.status+'. Check the bot in the existing initiation settings.');}
    t.pending.telegramState='sent';t.pending.telegramMessageId=data.result?.message_id;save();
    event('telegram-delivered',t.id,'Message saved in the server inbox; awaiting chat import.');
}
async function run(t){
    if(running)return;
    running=true;
    const id=crypto.randomUUID();
    try{
        if(!current(t)){t.lastError='Context changed. Open this chat to refresh its server context.';t.nextAt=Date.now()+60000;save();return;}
        if(activityBlocks(t)){t.nextAt=Date.now()+120000;save();return;}
        const chat=readFor(t),last=chat.rows.filter(m=>!m.is_system).at(-1);
        if(last?.is_user){t.lastError='Waiting for the current conversation to finish.';save();return;}
        t.job={id,stage:'generating',startedAt:Date.now()};t.lastError=null;save();
        event('generation-started',t.id,'One model request; no retries.');
        const request=structuredClone(t.snapshot.params);
        request.messages.push({role:'user',content:initiationInstruction(t.name,settings().username||'Joe',Date.now(),last.mes)});
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
        const text=typeof message?.content==='string'?message.content.trim():'';
        if(message?.tool_calls?.length)throw new Error('The provider returned a tool call; no action was executed.');
        if(text.length<2||text.length>3500||/<think>|<analysis>/i.test(text))throw new Error('The model returned an unsuitable notification response.');
        if(repeatText(text,chat.rows.filter(m=>!m.is_user&&!m.is_system).slice(-8).map(m=>m.mes)))throw new Error('Repeated message rejected. No replacement request was made.');
        if(!t.enabled||!current(t)||activityBlocks(t))throw new Error('Conversation activity changed or initiation was paused while generating; the message was not sent.');
        t.pending={id,text,createdAt:Date.now(),baseHash:chat.hash,baseSignature:chat.signature,telegramState:'not-sent',imported:false};
        t.awaitingReply=true;t.job=null;t.test=false;
        const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date());
        t.dayCount=t.day===day?(t.dayCount||0)+1:1;t.day=day;
        save(); // Durable copy exists before the external message is sent.
        await notify(t);
    }catch(error){
        t.job=null;t.test=false;t.awaitingReply=true;
        t.lastError=/HTTP|Telegram|Context|Conversation|Repeated|provider|model|SillyTavern|notification/.test(error.message)?error.message:'Initiation stopped; no automatic retry.';
        event('attempt-stopped',t.id,t.lastError);
    }finally{running=false;save();}
}
async function tick(){if(running)return;for(const t of Object.values(state.targets)){if(eligible(t,Date.now())){await run(t);break;}}}

async function dispatch(route,b){
    if(route==='/status')return {version:'0.1.0',running,targets:Object.values(state.targets).map(publicTarget),events:state.events.slice(-15),telegramConfigured:!!settings().extension_settings?.['ava-initiation']?.telegramToken};
    if(route==='/baseline')return baseline(b.avatar,b.chatId);
    if(route==='/activity'){browserActivity=Date.now();return {ok:true};}
    if(route==='/snapshot'){
        const id=targetId(b.avatar,b.chatId),chat=readChat(ROOT,b.avatar,b.chatId);
        validateSnapshot(b,chat);
        if(b.sourceHash!==sourceFingerprint(ROOT,b.avatar))throw new Error('Character or settings changed while preparing context. Try Refresh context.');
        if(JSON.stringify(b.params).length>8e6)throw new Error('Context is too large.');
        const a=settings().extension_settings?.['ava-initiation']||{};
        let t=state.targets[id];
        if(!t){if(b.enable!==true)throw new Error('Enable this chat first.');t=state.targets[id]={id,avatar:b.avatar,chatId:b.chatId,name:String(b.name).slice(0,100),enabled:true,min:Math.max(15,Number(a.min)||60),max:Math.max(15,Number(a.max)||120),quietStart:a.quietStart||'23:00',quietEnd:a.quietEnd||'08:00'};t.max=Math.max(t.min,t.max);}
        if(t.job)throw new Error('An initiation is already running.');
        if(t.pending&&!t.pending.imported)throw new Error('Import the pending message before refreshing context.');
        if(t.pending?.imported){
            const pos=chat.rows.findIndex(m=>m.extra?.server_initiation?.id===t.pending.id);
            if(pos<0)throw new Error('The imported message is missing from this chat. It remains in the server inbox.');
            if(chat.rows.slice(pos+1).some(m=>m.is_user)){t.archive=[...(t.archive||[]),t.pending].slice(-20);t.pending=null;t.awaitingReply=false;}
        }
        if(!t.pending&&(b.enable===true||t.snapshot?.chatHash!==chat.hash))t.awaitingReply=false;
        t.snapshot={params:b.params,chatHash:chat.hash,sourceHash:b.sourceHash,createdAt:Date.now()};
        if(b.enable===true)t.enabled=true;
        if(!t.awaitingReply){t.nextAt=Date.now()+nextDelay(t);t.lastError=null;}
        t.test=false;save();return publicTarget(t);
    }
    if(route==='/test'){
        const t=getTarget(b);
        if(t.job||t.pending&&!t.pending.imported)throw new Error('An attempt or pending message already exists.');
        if(!t.snapshot||!current(t))throw new Error('Refresh this chat’s server context first.');
        if(t.pending)throw new Error('Reply to the previous initiation before scheduling another.');
        t.enabled=true;t.awaitingReply=false;t.lastError=null;t.test=true;t.testArmedAt=Date.now();t.nextAt=Date.now()+60000;save();event('test-armed',t.id,'One server-owned test in 60 seconds.');return publicTarget(t);
    }
    if(route==='/pause'){const t=getTarget(b);t.enabled=false;t.test=false;save();return publicTarget(t);}
    if(route==='/inbox'){
        const t=state.targets[targetId(b.avatar,b.chatId)];
        if(!t?.pending||t.pending.imported)return {pending:null};
        return {pending:{id:t.pending.id,text:t.pending.text,createdAt:t.pending.createdAt,name:t.name,baseSignature:t.pending.baseSignature}};
    }
    if(route==='/claim'){
        const t=getTarget(b),p=t.pending;
        if(!p||p.id!==b.id||p.imported)throw new Error('No pending message.');
        if(t.lease&&t.lease.expires>Date.now())throw new Error('Another tab is importing this message.');
        const chat=readFor(t);
        if(chat.rows.some(m=>m.extra?.server_initiation?.id===p.id))return {alreadySaved:true};
        if(chat.signature!==b.signature)throw new Error('Reload this chat before importing: this tab differs from the server.');
        t.lease={token:crypto.randomUUID(),expires:Date.now()+45000};save();
        return {lease:t.lease.token,pending:{id:p.id,text:p.text,createdAt:p.createdAt,name:t.name}};
    }
    if(route==='/ack'){
        const t=getTarget(b),p=t.pending;
        if(!p||p.id!==b.id)throw new Error('Pending message not found.');
        const chat=readFor(t);
        if(!chat.rows.some(m=>m.extra?.server_initiation?.id===p.id&&m.mes===p.text&&!m.is_user))throw new Error('Chat save is not verified; the inbox copy is retained.');
        p.imported=true;p.importedAt=Date.now();t.lease=null;save();event('chat-import-verified',t.id,'Saved message ID and text verified.');return {ok:true};
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
