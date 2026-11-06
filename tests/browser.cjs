const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
const root = path.resolve(__dirname, '..');
const mocks = {
 '/scripts/extensions.js': `export const extension_settings={};export const extensionNames=[];export const getExtensionManifest=()=>null;export const getContext=()=>globalThis.fixture.c;`,
 '/scripts/tool-calling.js': `export class ToolManager {static canPerformToolCalls(){return true}static async registerFunctionToolsOpenAI(){}static async invokeFunctionTools(){throw Error('must not execute')}}`,
 '/scripts/chats.js': `export const hasPendingFileAttachment=()=>false;`,
 '/scripts/user.js': `export const getCurrentUserHandle=()=> 'test-user';`,
 '/scripts/constants.js': `export const MEDIA_TYPE={IMAGE:'image'};`,
 '/script.js': `export const event_types={CHAT_CHANGED:'chat',MESSAGE_SENT:'sent',MESSAGE_RECEIVED:'received',CHARACTER_MESSAGE_RENDERED:'rendered',GENERATION_STOPPED:'stop',GENERATION_AFTER_COMMANDS:'commands',CHAT_COMPLETION_PROMPT_READY:'prompt',CHAT_COMPLETION_SETTINGS_READY:'request'};
 const callbacks=new Map();export const eventSource={on(k,f){callbacks.set(k,[...(callbacks.get(k)||[]),f])},makeLast(k,f){this.on(k,f)},removeListener(k,f){callbacks.set(k,(callbacks.get(k)||[]).filter(x=>x!==f))},async emit(k,...args){for(const f of [...(callbacks.get(k)||[])])await f(...args)}};
 let generating=false;export const isGenerating=()=>generating;export const saveSettingsDebounced=()=>{};
 export function stopGeneration(){generating=false;eventSource.emit('stop')}
 export async function Generate(type,options){
 if(type!=='normal'||!options.automatic_trigger||!options.jsonSchema)throw Error('Wrong generation path');
 fixture.calls++;await eventSource.emit('commands',type,options,false);generating=true;
 try{const ev={chat:[{role:'system',content:'STATE TRACKER fixture: established relationship'}]};await eventSource.emit('prompt',ev);const req={messages:ev.chat,stream:fixture.c.chatCompletionSettings.stream_openai};await eventSource.emit('request',req);fixture.request=req;
 if(req.stream||req.tools)throw Error('Streaming/tools were not suppressed');
 if(fixture.hang)await new Promise(r=>fixture.release=r);
 return JSON.stringify({text:'A small hello from the character.'});}finally{generating=false}}
 globalThis.fixture={calls:0,hang:false,c:{avatar:'A',characterId:0,characters:[{avatar:'A'}],chatId:'chat-a',name2:'Test Companion',chat:[],mainApi:'openai',chatCompletionSettings:{stream_openai:true,function_calling:true,prompts:[]},getCharacterCardFields:()=>({description:'A fictional adult companion.'}),substituteParams:x=>x,getTokenCountAsync:async x=>Math.ceil(x.length/3),addOneMessage(m){const p=document.createElement('p');p.className='message';p.textContent=m.mes;document.getElementById('chat').append(p)},saveChat:async()=>{}}};
 globalThis.host={eventSource,event_types};`,
};
const html=`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{font:16px system-ui;background:#202020;color:#eee;margin:12px}#extensions_settings{display:flex;flex-direction:column;width:100%}.inline-drawer-header{padding:12px;background:#333}.inline-drawer-content{display:block}input,select,button{font:inherit}button{cursor:pointer}#send_textarea{width:100%;height:60px}</style></head><body><div id="extensions_settings"></div><div id="following">Next extension</div><div id="chat"></div><textarea id="send_textarea"></textarea><script type="module" src="/scripts/extensions/third-party/ava-initiation/index.js"></script></body></html>`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const p=req.url.split('?')[0];if(p==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
  if(mocks[p]){res.setHeader('Content-Type','text/javascript');res.end(mocks[p]);return}
  if(p==='/scripts/extensions/third-party/ava-initiation/index.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'index.js')));return}
  res.statusCode=404;res.end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu'],headless:true});
 try{
  const context=await browser.newContext({viewport:{width:393,height:852}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#ava-fire').waitFor();
  assert.equal(await page.locator('[data-setting=enabled]').isChecked(),false);assert.equal(await page.locator('#ava-allow').isChecked(),false);
  await page.locator('#ava-fire').click();assert.equal(await page.locator('.message').count(),0);
  // Permission-denied path leaves an in-page badge after delivery.
  await page.evaluate(()=>{Notification.requestPermission=async()=> 'denied'});
  await page.locator('#ava-allow').check();await page.waitForTimeout(100);
  await page.locator('[data-setting=enabled]').check();await page.waitForTimeout(100);
  await page.locator('#ava-fire').click();await page.waitForFunction(()=>document.querySelectorAll('.message').length===1);
  assert.equal(await page.evaluate(()=>fixture.c.chat.filter(m=>m.is_user).length),0);
  assert.equal(await page.evaluate(()=>fixture.c.chatCompletionSettings.function_calling),true);
  assert.equal(await page.evaluate(()=>fixture.c.chatCompletionSettings.stream_openai),true);
  assert.equal(await page.evaluate(()=>fixture.request.messages.some(m=>m.content.includes('STATE TRACKER fixture'))),true);
  assert.equal(await page.evaluate(()=>fixture.request.messages.some(m=>m.content.includes('do not continue or answer'))),true);
  assert.equal(await page.locator('#ava-unread-float').isVisible(),true);
  await page.waitForTimeout(300);assert.equal(await page.locator('.message').count(),1);
  // A draft must survive Fire now unchanged.
  await page.locator('#send_textarea').fill('An unfinished thought');await page.locator('#ava-fire').click();
  assert.equal(await page.locator('#send_textarea').inputValue(),'An unfinished thought');assert.equal(await page.locator('.message').count(),1);
  // No overflow or one-letter buttons on small screens; drawer owns its scroll.
  for(const width of [320,393,709,1024]){
   await page.setViewportSize({width,height:852});
   const bounds=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,body:document.querySelector('.ava-body').getBoundingClientRect().height,button:document.querySelector('#ava-fire').getBoundingClientRect().height,following:document.querySelector('#following').getBoundingClientRect().top,bottom:document.querySelector('#ava-initiation-settings').getBoundingClientRect().bottom}));
   assert.ok(bounds.width<=bounds.viewport,JSON.stringify(bounds));assert.ok(bounds.button>=44);assert.ok(bounds.body<=554);assert.ok(bounds.following>=bounds.bottom-1);
  }
  await page.setViewportSize({width:393,height:852});await page.locator('#ava-status').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'tests/mobile-check.png')});
  // Granted-permission path. This headless Chromium build always reports native
  // permission denied, even after grantPermissions. Model the permission grant
  // explicitly and spy on the real module worker's showNotification boundary.
  // Page -> MessageChannel -> production worker -> display API is exercised;
  // native Android notification display remains a live smoke check.
  await page.locator('[data-setting=enabled]').uncheck();
  await page.waitForFunction(()=>Object.keys(localStorage).filter(k=>k.endsWith(':data')).every(k=>!JSON.parse(localStorage.getItem(k)).config.enabled));
  await page.evaluate(async()=>{fixture.c.chatId='chat-granted';fixture.c.chat=[];document.getElementById('chat').replaceChildren();await host.eventSource.emit('chat')});
  await page.locator('#send_textarea').fill('');
  await page.locator('[data-setting=preview]').selectOption('full');
  await page.evaluate(()=>{
   globalThis.permissionRequests=0;globalThis.testPermission='default';
   Object.defineProperty(Notification,'permission',{configurable:true,get:()=>testPermission});
   Notification.requestPermission=async()=>{permissionRequests++;testPermission='granted';return testPermission};
  });
  const workerStarted=context.waitForEvent('serviceworker');
  await page.locator('[data-setting=enabled]').check();
  const worker=await workerStarted;
  await page.waitForFunction(async()=> (await navigator.serviceWorker.getRegistrations()).some(r=>r.active));
  assert.equal(await page.evaluate(()=>permissionRequests),1);
  assert.equal(await page.evaluate(()=>Notification.permission),'granted');
  await worker.evaluate(()=>{
   self.notificationCalls=[];
   self.registration.showNotification=async(title,options)=>{self.notificationCalls.push({title,options})};
  });
  await page.waitForTimeout(200);
  await page.locator('#ava-fire').click();
  await page.waitForTimeout(200);
  await page.waitForFunction(()=>document.querySelectorAll('.message').length===1);
  for(let i=0;i<30 && !(await worker.evaluate(()=>self.notificationCalls.length));i++)await page.waitForTimeout(100);
  const full=await worker.evaluate(()=>self.notificationCalls);
  assert.equal(full.length,1,'granted permission must call showNotification once');
  assert.equal(full[0].title,'Ava');assert.equal(full[0].options.body,'A small hello from the character.');
  assert.ok(full[0].options.tag.startsWith('ava:'));assert.equal(full[0].options.data.url,url+'/');
  await page.locator('[data-setting=preview]').selectOption('generic');
  await page.waitForTimeout(200);
  await page.locator('#ava-fire').click();
  await page.waitForFunction(()=>document.querySelectorAll('.message').length===2);
  for(let i=0;i<30 && (await worker.evaluate(()=>self.notificationCalls.length))<2;i++)await page.waitForTimeout(100);
  const generic=await worker.evaluate(()=>self.notificationCalls);
  assert.equal(generic.length,2);assert.equal(generic[1].title,'Ava');assert.equal(generic[1].options.body,undefined);
  assert.equal(generic[1].options.tag,full[0].options.tag,'same chat replaces instead of stacking');
  assert.equal(await page.evaluate(()=>fixture.c.chat.filter(m=>m.is_user).length),0);
  const regs=await page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.scriptURL??null,registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,script:r.active?.scriptURL}))}));
  assert.equal(regs.controller,null);assert.ok(regs.registrations[0].scope.endsWith('/scripts/extensions/third-party/ava-initiation/'));
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS browser harness: disabled defaults, one text/no user turn, no follow-up, restored settings, denied-permission badge; controlled permission grant from enable toggle; real module-worker showNotification spy for full/generic previews and per-chat replacement; draft preservation; mobile 320/393/709/1024px; own-directory worker.');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
