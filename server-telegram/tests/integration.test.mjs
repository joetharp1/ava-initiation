import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readChat,sourceFingerprint,targetId,atomicWrite,rowKeys} from '../server/core.mjs';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await delay(30);}throw new Error('Timed out');}
async function fixture(mode='normal'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'init-integration-')),root=path.join(dir,'data'),stateRoot=path.join(dir,'state');
 fs.mkdirSync(path.join(root,'chats','Mollie'),{recursive:true});fs.mkdirSync(path.join(root,'characters'));fs.mkdirSync(stateRoot);
 fs.writeFileSync(path.join(root,'characters','Mollie.png'),'test-card');
 fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({username:'Joe',extension_settings:{'ava-initiation':{telegramToken:'test',telegramChatId:'42'}}}));
 const rows=[{chat_metadata:{}},{name:'Joe',is_user:true,mes:'I enjoyed our walk.'},{name:'Mollie',is_user:false,mes:'Me too. The trees looked lovely.'}];
 const chatFile=path.join(root,'chats','Mollie','chat.jsonl');fs.writeFileSync(chatFile,rows.map(x=>JSON.stringify(x)).join('\n'));
 const initial=fs.readFileSync(chatFile,'utf8'),chat=readChat(root,'Mollie.png','chat'),id=targetId('Mollie.png','chat');
 let generations=0,telegrams=0,received=null,telegramBodies=[];
 const mock=http.createServer(async(req,res)=>{
   if(req.url==='/csrf-token'){res.setHeader('Set-Cookie','session=test');res.end(JSON.stringify({token:'csrf'}));return;}
   let raw='';for await(const chunk of req)raw+=chunk;
   if(req.url.includes('/generate')){generations++;received=JSON.parse(raw);if(mode==='slow')await delay(250);res.end(JSON.stringify({choices:[{message:{content:mode==='dsml'?'<｜DSML｜ calls><｜DSML｜ invoke name="VeniceCreateSelfPortrait"><｜DSML｜ parameter name="prompt" string="true">Reading in a blue jumper.</｜DSML｜ parameter></｜DSML｜ invoke></｜DSML｜ calls>':generations===1?'I spotted a little bookshop and thought you might enjoy exploring it with me.':'There is a new astronomy exhibition at the museum; those photographs look wonderful.'}}]}));}
   else if(req.url.includes('/sendMessage')){telegrams++;telegramBodies.push(JSON.parse(raw));assert(fs.existsSync(path.join(stateRoot,'state.json')));const saved=JSON.parse(fs.readFileSync(path.join(stateRoot,'state.json')));assert(saved.targets[id].pending.text);res.end(JSON.stringify({ok:true,result:{message_id:100}}));}
   else {res.statusCode=404;res.end();}
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));const mockPort=mock.address().port;
 const free=http.createServer();await new Promise(r=>free.listen(0,'127.0.0.1',r));const port=free.address().port;await new Promise(r=>free.close(r));
 const target={id,avatar:'Mollie.png',chatId:'chat',name:'Mollie',enabled:true,min:60,max:120,quietStart:'00:00',quietEnd:'00:00',nextAt:0,queue:[],snapshot:{rowKeys:rowKeys(chat.rows),chatHash:chat.hash,sourceHash:sourceFingerprint(root,'Mollie.png'),params:{messages:[{role:'system',content:'Test character'},{role:'assistant',content:rows[2].mes}],model:'test-model',chat_completion_source:'custom',custom_url:'https://api.venice.ai/api/v1'}}};
 if(mode==='stale')fs.appendFileSync(chatFile,'\n'+JSON.stringify({is_user:true,mes:'A new message'}));
 atomicWrite(path.join(stateRoot,'state.json'),{version:2,targets:{[id]:target},events:[]});
 const env={...process.env,NODE_ENV:'test',ST_DATA_ROOT:root,STATE_ROOT:stateRoot,ST_USER:'user',ST_PASSWORD:'password',PUBLIC_ORIGIN:'http://localhost',ST_URL:`http://127.0.0.1:${mockPort}`,TEST_TELEGRAM_PORT:String(mockPort),TEST_PORT:String(port)};
 let child;
 function start(){child=spawn(process.execPath,[new URL('../server/server.mjs',import.meta.url).pathname],{env,stdio:['ignore','pipe','pipe']});child.stderr.on('data',b=>process.stderr.write(b));}
 async function stop(){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
 start();
 async function api(route,body={},auth=true){const r=await fetch(`http://127.0.0.1:${port}/astra-initiation${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-Astra-Initiation':'1',...(auth?{Authorization:'Basic '+Buffer.from('user:password').toString('base64')}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.text().then(s=>s?JSON.parse(s):null)};}
 await until(async()=>{try{return (await api('/status')).status===200;}catch{return false;}});
 return {api,root,stateRoot,id,chatFile,initial,rows,metrics:()=>({generations,telegrams,received,telegramBodies}),start,stop,cleanup:async()=>{await stop();await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true});}};
}
test('server works with no browser, persists before Telegram, imports by verified receipt, never duplicates on restart',async()=>{
 const f=await fixture();try{
  await until(()=>f.metrics().telegrams===1);assert.equal(f.metrics().generations,1);assert.equal(fs.readFileSync(f.chatFile,'utf8'),f.initial);
  assert.equal((await f.api('/status',{},false)).status,401);
  const identity={avatar:'Mollie.png',chatId:'chat'},inbox=(await f.api('/inbox',identity)).data.pending;assert(inbox.text);
  assert.equal((await f.api('/ack',{...identity,id:inbox.id})).status,400);
  fs.appendFileSync(f.chatFile,'\n'+JSON.stringify({name:'Mollie',is_user:false,mes:inbox.text,extra:{server_initiation:{id:inbox.id}}}));
  assert.equal((await f.api('/ack',{...identity,id:inbox.id})).status,200);
  await f.stop();f.start();await delay(350);assert.equal(f.metrics().generations,1);assert.equal(f.metrics().telegrams,1);
  assert.equal(f.metrics().received.stream,false);assert.equal(f.metrics().received.max_tokens,700);assert.equal(f.metrics().received.messages.at(-1).role,'user');
 }finally{await f.cleanup();}
});
test('changed history blocks generation and delivery',async()=>{const f=await fixture('stale');try{await delay(250);assert.equal(f.metrics().generations,0);assert.equal(f.metrics().telegrams,0);}finally{await f.cleanup();}});
test('pausing during an in-flight model call prevents Telegram delivery',async()=>{const f=await fixture('slow');try{await until(()=>f.metrics().generations===1);await f.api('/pause',{avatar:'Mollie.png',chatId:'chat'});await delay(400);assert.equal(f.metrics().telegrams,0);}finally{await f.cleanup();}});

test('unanswered follow-ups preserve both receipts, use prior text, and remain Telegram text only',async()=>{
 const f=await fixture();try{
  await until(()=>f.metrics().telegrams===1);await f.stop();
  const file=path.join(f.stateRoot,'state.json'),state=JSON.parse(fs.readFileSync(file));
  state.targets[f.id].nextAt=0;state.targets[f.id].dayCount=200;state.targets[f.id].awaitingReply=true;
  atomicWrite(file,state);f.start();await until(()=>f.metrics().telegrams===2);
  const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.targets[f.id].queue.length,2);
  assert(f.metrics().received.messages.some(m=>m.content===saved.targets[f.id].queue[0].text));
  for(const b of f.metrics().telegramBodies){assert.equal(typeof b.text,'string');assert.equal(b.photo,undefined);assert.equal(b.video,undefined);assert.equal(b.link_preview_options.is_disabled,true);}
  const identity={avatar:'Mollie.png',chatId:'chat'};
  for(let i=0;i<2;i++){
   const p=(await f.api('/inbox',identity)).data.pending;assert.equal(p.id,saved.targets[f.id].queue[i].id);
   fs.appendFileSync(f.chatFile,'\n'+JSON.stringify({is_user:false,mes:p.text,extra:{server_initiation:{id:p.id}}}));
   assert.equal((await f.api('/ack',{...identity,id:p.id})).status,200);
  }
  assert.equal((await f.api('/inbox',identity)).data.pending,null);
 }finally{await f.cleanup();}
});
test('settings and new journal files do not invalidate captured conversation',async()=>{
 const f=await fixture();try{
  await until(()=>f.metrics().telegrams===1);
  const file=path.join(f.root,'settings.json'),s=JSON.parse(fs.readFileSync(file));s.extension_settings.journal={latestEntry:'new'};fs.writeFileSync(file,JSON.stringify(s));
  fs.mkdirSync(path.join(f.root,'user/files'),{recursive:true});fs.writeFileSync(path.join(f.root,'user/files/journal.md'),'Synthetic journal fixture');
  assert.equal((await f.api('/status')).data.targets[0].contextReady,true);
 }finally{await f.cleanup();}
});

test('serialized portrait with unavailable image setup delivers an honest failure notice, never its prompt',async()=>{
 const f=await fixture('dsml');try{
  await until(()=>f.metrics().telegrams===1);
  const body=f.metrics().telegramBodies[0];assert.match(body.text,/photo could not be created/);
  assert(!body.text.includes('DSML'));assert(!body.text.includes('blue jumper'));
  const p=(await f.api('/inbox',{avatar:'Mollie.png',chatId:'chat'})).data.pending;
  assert.match(p.text,/photo could not be created/);assert.equal(p.imageUrl,undefined);
 }finally{await f.cleanup();}
});
