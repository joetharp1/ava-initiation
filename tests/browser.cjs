const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
const root = path.resolve(__dirname, '..');
const mocks = {
 '/scripts/extensions.js': `export const extension_settings=globalThis.fixtureSettings=JSON.parse(localStorage.getItem('fixture-settings')||'{}');export const extensionNames=[];export const getExtensionManifest=()=>null;export const getContext=()=>globalThis.fixture.c;`,
 '/scripts/tool-calling.js': `export class ToolManager {static canPerformToolCalls(){return true}static async registerFunctionToolsOpenAI(){}static async invokeFunctionTools(){throw Error('must not execute')}}`,
 '/scripts/chats.js': `export const hasPendingFileAttachment=()=>false;`,
 '/scripts/user.js': `export const getCurrentUserHandle=()=> 'test-user';`,
 '/scripts/constants.js': `export const MEDIA_TYPE={IMAGE:'image'};`,
 '/script.js': `export const event_types={CHAT_CHANGED:'chat',MESSAGE_SENT:'sent',MESSAGE_RECEIVED:'received',CHARACTER_MESSAGE_RENDERED:'rendered',GENERATION_STOPPED:'stop',GENERATION_AFTER_COMMANDS:'commands',CHAT_COMPLETION_PROMPT_READY:'prompt',CHAT_COMPLETION_SETTINGS_READY:'request'};
 const callbacks=new Map();export const eventSource={on(k,f){callbacks.set(k,[...(callbacks.get(k)||[]),f])},makeLast(k,f){this.on(k,f)},removeListener(k,f){callbacks.set(k,(callbacks.get(k)||[]).filter(x=>x!==f))},async emit(k,...args){for(const f of [...(callbacks.get(k)||[])])await f(...args)}};
 export const getRequestHeaders=()=>({'Content-Type':'application/json'});
 let generating=false;export const isGenerating=()=>generating;export const saveSettingsDebounced=()=>{localStorage.setItem('fixture-settings',JSON.stringify(globalThis.fixtureSettings))};
 export function stopGeneration(){generating=false;eventSource.emit('stop')}
 export async function Generate(type,options){
 if(type!=='normal'||!options.automatic_trigger||!options.jsonSchema)throw Error('Wrong generation path');
 fixture.calls++;await eventSource.emit('commands',type,options,false);generating=true;
 try{const ev={chat:[{role:'system',content:'STATE TRACKER fixture: established relationship'}]};await eventSource.emit('prompt',ev);const req={messages:ev.chat,stream:fixture.c.chatCompletionSettings.stream_openai};await eventSource.emit('request',req);fixture.request=req;
 if(req.stream||req.tools)throw Error('Streaming/tools were not suppressed');
 if(fixture.hang)await new Promise(r=>fixture.release=r);
 return fixture.output ?? JSON.stringify({text:fixture.calls===1?'A small hello from the character.':['Fancy a walk?', 'I found something for you.', 'What are we having for tea?', 'Put some music on.'][fixture.calls%4]});}finally{generating=false}}
 globalThis.fixture={calls:0,hang:false,c:{avatar:'A',characterId:0,characters:[{avatar:'A'}],chatId:'chat-a',name2:'Test Companion',chat:[],mainApi:'openai',chatCompletionSettings:{stream_openai:true,function_calling:true,prompts:[]},getCharacterCardFields:()=>({description:'A fictional adult companion.'}),substituteParams:x=>x,getTokenCountAsync:async x=>Math.ceil(x.length/3),addOneMessage(m){const p=document.createElement('p');p.className='message';p.textContent=m.mes;document.getElementById('chat').append(p)},saveChat:async()=>{fixture.saved[fixture.c.chatId]=structuredClone(fixture.c.chat)}}};
 fixture.saved={};const originalFetch=globalThis.fetch;globalThis.fetch=(url,options)=>url==='/api/chats/get'?Promise.resolve(new Response(JSON.stringify([{chat_metadata:{}},...(fixture.saved[JSON.parse(options.body).file_name]||[])]),{status:200,headers:{'Content-Type':'application/json'}})):originalFetch(url,options);
 globalThis.host={eventSource,event_types};`,
};
const html=`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{font:16px system-ui;background:#202020;color:#eee;margin:12px}#extensions_settings{display:flex;flex-direction:column;width:100%}.inline-drawer-header{padding:12px;background:#333}.inline-drawer-content{display:block}input,select,button{font:inherit}input{color:inherit;background:white}button{cursor:pointer}#send_textarea{width:100%;height:60px}</style></head><body><div id="extensions_settings"></div><div id="following">Next extension</div><div id="chat"></div><textarea id="send_textarea"></textarea><script type="module" src="/scripts/extensions/third-party/ava-initiation/index.js"></script></body></html>`;
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
  await context.addInitScript(()=>{
   if(!localStorage.getItem('ava-initiation:v1:test-user:request-diagnostics-v1'))localStorage.setItem('ava-initiation:v1:test-user:request-diagnostics-v1',JSON.stringify({chat:'[\"A\",\"chat-a\"]',attempts:[{id:'old-1'},{id:'old-2'}]}));
  });
  const diagnosticConsole=[];page.on('console',m=>{if(m.text().includes('[Ava request diagnostic]'))diagnosticConsole.push(m.text())});
  await page.goto(url);await page.locator('#ava-fire').waitFor();
  assert.equal(await page.locator('#ava-fire').isDisabled(),false);
  assert.equal(await page.locator('#ava-diagnose').count(),0);
  const retainedDiagnostic=await page.evaluate(()=>localStorage.getItem('ava-initiation:v1:test-user:request-diagnostics-v1'));
  assert.equal(await page.locator('[data-setting=enabled]').isChecked(),false);assert.equal(await page.locator('#ava-allow').isChecked(),false);
  await page.locator('#ava-fire').click();assert.equal(await page.locator('.message').count(),0);
  // Permission-denied path leaves an in-page badge after delivery.
  await page.evaluate(()=>{Notification.requestPermission=async()=> 'denied'});
  await page.locator('[data-setting=browserNotifications]').check();await page.waitForTimeout(100);
  await page.locator('#ava-allow').check();await page.waitForTimeout(100);
  await page.locator('[data-setting=enabled]').check();await page.waitForTimeout(100);
  await page.locator('#ava-fire').click();await page.waitForFunction(()=>document.querySelectorAll('.message').length===1);
  assert.equal(await page.evaluate(()=>fixture.c.chat.filter(m=>m.is_user).length),0);
  assert.equal(await page.evaluate(()=>fixture.c.chatCompletionSettings.function_calling),true);
  assert.equal(await page.evaluate(()=>fixture.c.chatCompletionSettings.stream_openai),true);
  assert.equal(await page.evaluate(()=>fixture.request.messages.some(m=>m.content.includes('STATE TRACKER fixture'))),true);
  assert.equal(await page.evaluate(()=>fixture.request.messages.at(-1).role),'user');
  assert.equal(await page.evaluate(()=>fixture.request.messages.at(-1).content.includes('No new user message has arrived')),true);
  assert.equal(await page.evaluate(()=>fixture.request.messages.some(m=>m.content.includes('do not continue or answer'))),true);
  assert.equal(await page.evaluate(()=>fixture.request.messages.some(m=>m.content.includes('Do not include a name or timestamp header, just the message body'))),true);
  const deviceStamp=await page.evaluate(()=>({now:Date.now(),sent:fixture.c.chat[0].send_date,meta:fixture.c.chat[0].extra.ava_initiation.timestamp}));
  assert.equal(typeof deviceStamp.sent,'number');assert.equal(deviceStamp.meta,deviceStamp.sent);
  assert.ok(Math.abs(deviceStamp.now-deviceStamp.sent)<5000,'message timestamp must use browser clock');
  assert.equal(await page.locator('#ava-unread-float').isVisible(),true);
  assert.match(await page.locator('#ava-notifications').innerText(),/permission denied/i);
  assert.match(await page.locator('#ava-notification-log').textContent(),/Notification permission: denied/);
  await page.waitForTimeout(300);assert.equal(await page.locator('.message').count(),1);
  // A draft must survive Fire now unchanged.
  await page.locator('#send_textarea').fill('An unfinished thought');await page.locator('#ava-fire').click();
  assert.equal(await page.locator('#send_textarea').inputValue(),'An unfinished thought');assert.equal(await page.locator('.message').count(),1);
  // Reproduce the host's inherited light text on native white inputs, then
  // verify Ava owns both colours and retains the number/time values.
  const fieldColours=await page.evaluate(()=>[...document.querySelectorAll('#ava-initiation-settings input[type=number],#ava-initiation-settings input[type=time]')].map(el=>({value:el.value,bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color,fill:getComputedStyle(el).webkitTextFillColor})));
  assert.deepEqual(fieldColours.map(x=>x.value),['60','120','23:00','08:00','0.12']);
  for(const c of fieldColours){assert.equal(c.bg,'rgb(32, 32, 32)');assert.equal(c.fg,'rgb(245, 245, 245)');assert.equal(c.fill,c.fg)}
  // No overflow or one-letter buttons on small screens; drawer owns its scroll.
  for(const width of [320,393,709,1024]){
   await page.setViewportSize({width,height:852});
   const bounds=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,body:document.querySelector('.ava-body').getBoundingClientRect().height,button:document.querySelector('#ava-fire').getBoundingClientRect().height,following:document.querySelector('#following').getBoundingClientRect().top,bottom:document.querySelector('#ava-initiation-settings').getBoundingClientRect().bottom}));
   assert.ok(bounds.width<=bounds.viewport,JSON.stringify(bounds));assert.ok(bounds.button>=44);assert.ok(bounds.body<=554);assert.ok(bounds.following>=bounds.bottom-1);
  }
  await page.setViewportSize({width:393,height:852});await page.locator('[data-setting=min]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'tests/mobile-check.png')});
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
  await page.waitForFunction(()=>document.querySelector('#ava-notifications').textContent.includes('worker active'));
  assert.match(await page.locator('#ava-notification-log').textContent(),/Registration resolved/);
  assert.match(await page.locator('#ava-notification-log').textContent(),/Ava worker activated/);
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
  // A bad provider result is visible in the saved log; Fire now retries now.
  await page.waitForTimeout(200);
  await page.evaluate(()=>{fixture.output='{"text":""}'});
  await page.locator('#ava-fire').click();
  await page.waitForFunction(()=>document.querySelector('#ava-log').textContent.includes('Raw output:'));
  assert.equal(await page.locator('.message').count(),2);
  const failed=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith(':data')))));
  assert.ok(failed.log.some(r=>r.outcome==='failed' && r.text.includes('Raw output:')));
  assert.ok(failed.chats['["A","chat-granted"]'].retryAt>Date.now());
  await page.evaluate(()=>{fixture.output='{"text":"Manual retry succeeded"}'});
  await page.locator('#ava-fire').click();
  await page.waitForFunction(()=>document.querySelectorAll('.message').length===3);
  assert.equal(await page.locator('.message').last().innerText(),'Manual retry succeeded');
  await page.waitForTimeout(200);
  // A protected worker is optional; Telegram remains independent of its 401.
  await page.locator('[data-setting=enabled]').uncheck();await page.waitForTimeout(200);
  await page.evaluate(()=>{navigator.serviceWorker.register=async()=>{throw Error('A bad HTTP response code (401) was received when fetching the script.')}});
  await page.locator('[data-setting=enabled]').check();
  await page.waitForFunction(()=>document.querySelector('#ava-notifications').textContent.includes('requires sign-in'));
  assert.equal(await page.evaluate(()=>Notification.permission),'granted');
  assert.doesNotMatch(await page.locator('#ava-notifications').innerText(),/setup failed|error/i);
  const telegramRequests=[];let rejectTelegram=false;
  await page.route('https://api.telegram.org/**', async route=>{
   telegramRequests.push(new URLSearchParams(route.request().postData()));
   if(rejectTelegram)await route.fulfill({status:401,contentType:'application/json',body:'{ "ok": false, "error_code": 401, "description": "Unauthorized" }'});
   else await route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  });
  const fakeToken='123456789:TEST_ONLY_NOT_A_REAL_TOKEN_12345';
  await page.locator('#ava-telegram-token').fill(fakeToken);
  await page.locator('#ava-telegram-token').press('Tab');
  await page.locator('[data-setting=telegramChatId]').fill('-123456789');
  await page.locator('[data-setting=telegramChatId]').press('Tab');await page.waitForTimeout(100);
  await page.locator('[data-setting=telegramEnabled]').check();await page.waitForTimeout(100);
  await page.evaluate(()=>{fixture.output=null});
  await page.locator('#ava-fire').click();
  await page.waitForFunction(()=>document.querySelector('#ava-telegram-status').textContent.includes('notification sent'));
  assert.equal(telegramRequests.length,1);assert.equal(telegramRequests[0].get('text'),'Ava');
  assert.equal(telegramRequests[0].get('disable_notification'),'false');assert.equal(telegramRequests[0].get('chat_id'),'-123456789');
  assert.equal(await page.locator('.message').count(),4);
  const secretCheck=await page.evaluate(async()=>({db:localStorage.getItem('ava-initiation:v1:test-user:data'),
   token:(await import('/scripts/extensions.js')).extension_settings['ava-initiation'].telegramToken,
   settings:JSON.stringify((await import('/scripts/extensions.js')).extension_settings),prompt:JSON.stringify(fixture.request),
   diagnostics:document.querySelector('#ava-notification-log').textContent}));
  assert.equal(secretCheck.token,fakeToken);assert.ok(secretCheck.settings.includes(fakeToken),'token stored in ST extension settings');
  for(const key of ['db','prompt','diagnostics'])assert.ok(!secretCheck[key].includes(fakeToken),key+' must not contain token');
  await page.locator('[data-setting=preview]').selectOption('full');await page.waitForTimeout(100);
  await page.evaluate(()=>{fixture.output=JSON.stringify({text:'A'.repeat(250)})});
  await page.locator('#ava-fire').click();
  await page.waitForFunction(()=>document.querySelector('#ava-telegram-status').textContent.includes('notification sent'));
  assert.equal(telegramRequests.length,2);assert.equal(telegramRequests[1].get('text'),'A'.repeat(200));
  assert.equal(telegramRequests[1].get('disable_notification'),'false');
  // A notification failure cannot undo a delivered chat message or trigger retry.
  rejectTelegram=true;
  await page.evaluate(()=>{fixture.output=JSON.stringify({text:'Another opening for the failure test.'})});
  await page.locator('#ava-fire').click();
  await page.waitForFunction(()=>document.querySelector('#ava-telegram-status').textContent.includes('delivery unavailable'));
  assert.equal(await page.locator('.message').count(),6);assert.equal(telegramRequests.length,3);
  assert.equal(await page.locator('#ava-unread-float').isVisible(),true);
  const afterFailure=await page.evaluate(()=>JSON.parse(localStorage.getItem('ava-initiation:v1:test-user:data')));
  assert.equal(afterFailure.chats['["A","chat-granted"]'].state,'sent');
  await page.waitForTimeout(300);assert.equal(telegramRequests.length,3);
  // Send test is explicit, shows the exact API response, and adds no chat turn.
  await page.locator('#ava-telegram-test').click();
  await page.waitForFunction(()=>!document.querySelector('#ava-telegram-test').disabled);
  assert.equal(await page.locator('#ava-telegram-result').textContent(),'{ "ok": false, "error_code": 401, "description": "Unauthorized" }');
  assert.equal(telegramRequests.length,4);assert.equal(await page.locator('.message').count(),6);
  rejectTelegram=false;
  await page.locator('#ava-telegram-test').click();
  await page.waitForFunction(()=>!document.querySelector('#ava-telegram-test').disabled);
  assert.equal(await page.locator('#ava-telegram-result').textContent(),'{"ok":true}');
  assert.equal(telegramRequests.length,5);assert.equal(telegramRequests[4].get('text'),'Ava notification test.');
  // Credentials suppress worker registration despite the browser option staying on.
  assert.equal(await page.locator('[data-setting=browserNotifications]').isChecked(),true);
  await page.addInitScript(()=>{globalThis.registrationAttempts=0;navigator.serviceWorker.register=async()=>{registrationAttempts++;throw Error('must remain optional')}});
  await page.reload();await page.locator('#ava-fire').waitFor();
  assert.equal(await page.evaluate(()=>registrationAttempts),0);
  assert.equal(await page.locator('[data-setting=telegramChatId]').inputValue(),'-123456789');
  assert.equal(await page.locator('#ava-telegram-token').inputValue(),fakeToken);
  assert.match(await page.locator('#ava-notifications').innerText(),/worker skipped/);
  // Existing 0.1.6 tokens migrate to ST settings, then their legacy copy is removed.
  await page.evaluate(token=>{
   const settings=JSON.parse(localStorage.getItem('fixture-settings'));
   delete settings['ava-initiation'].telegramToken;
   localStorage.setItem('fixture-settings',JSON.stringify(settings));
   localStorage.setItem('ava-initiation:v1:test-user:telegram-token',token);
  },fakeToken);
  await page.reload();await page.locator('#ava-fire').waitFor();
  assert.equal(await page.locator('#ava-telegram-token').inputValue(),fakeToken);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-settings'))['ava-initiation'].telegramToken),fakeToken);
  assert.equal(await page.evaluate(()=>registrationAttempts),0);
  await page.reload();await page.locator('#ava-fire').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('ava-initiation:v1:test-user:telegram-token')),null);
  assert.equal(await page.locator('#ava-telegram-token').inputValue(),fakeToken);

  // An overdue ordinary timer runs despite the completed 0.1.8 diagnostic quota.
  await page.evaluate(async()=>{
   const key='ava-initiation:v1:test-user:data',db=JSON.parse(localStorage.getItem(key));
   db.chats['["A","chat-a"]']={...db.chats['["A","chat-a"]'],state:'waiting',unansweredAt:null,sulkUsed:false,nextAt:Date.now()-1,pending:null,attempt:null,retryAt:0};
   localStorage.setItem(key,JSON.stringify(db));await host.eventSource.emit('chat');
  });
  await page.waitForFunction(()=>document.querySelectorAll('.message').length===1);
  assert.equal(await page.evaluate(()=>fixture.c.chat.filter(m=>m.is_user).length),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('ava-initiation:v1:test-user:request-diagnostics-v1')),retainedDiagnostic);
  assert.equal(diagnosticConsole.length,0,'no new prompt capture during normal operation');
  // Exercise the real bootPage adapter: line saved before bridge request,
  // exactly one unread/notification, and a visible partial failure.
  for (const failPhoto of [false, true]) {
   await page.evaluate(async fail => {
    fixture.c.chatId=fail?'photo-failure':'photo-success'; fixture.c.chat=[];fixture.output=null;
    document.getElementById('chat').replaceChildren();fixture.saveCount=0;
    fixture.c.saveChat=async()=>{fixture.saveCount++;fixture.saved[fixture.c.chatId]=structuredClone(fixture.c.chat)};
    crypto.getRandomValues=array=>{array.fill(0);return array};
    globalThis[Symbol.for('ava.veniceBridge')]={initiationVersion:1,busy:false,
     initiationStatus:()=>({ready:true,costUsd:.06}),claimInitiation(){},releaseInitiation(){},endInitiation(){},cancel(){},
     beginInitiation: options=>options,
     async generateInitiation(token,scene){
      if(fixture.saveCount!==1||fixture.c.chat.length!==1)throw Error('Line was not saved before image');
      token.beforeRequest(.06);
      if(fail)throw Error('HTTP 400: raw test image rejection');
      const message={mes:'',extra:{ava_initiation:{attemptId:token.attemptId,type:'photo'},media:[{url:'/test-image.png'}]}};
      fixture.c.chat.push(message);fixture.c.addOneMessage(message);token.onPublished(1,message);
      await fixture.c.saveChat(); return JSON.stringify({status:'created'});
     }};
    await host.eventSource.emit('chat');
   },failPhoto);
   await page.locator('#ava-fire').click();
   await page.waitForFunction(fail=>document.querySelector('#ava-status').textContent.includes(fail?'photo failed:':'Sent. Waiting'),failPhoto);
   const result=await page.evaluate(()=>({chat:fixture.c.chat,saveCount:fixture.saveCount,
    db:JSON.parse(localStorage.getItem('ava-initiation:v1:test-user:data')),key:JSON.stringify(['A',fixture.c.chatId])}));
   assert.equal(result.chat.length,failPhoto?1:2);assert.equal(result.saveCount,failPhoto?1:2);
   assert.equal(result.db.chats[result.key].unread,1);
   const records=result.db.log.filter(r=>r.chat===result.key);
   assert.equal(records.filter(r=>r.outcome==='sent').length,1);
   if(failPhoto)assert.ok(records.some(r=>r.type==='photo'&&r.outcome==='failed'&&r.text.includes('raw test image rejection')));
   else assert.equal(records.find(r=>r.outcome==='sent').image,'/test-image.png');
  }
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS browser harness: disabled defaults, one text/no user turn, no follow-up, restored settings, denied-permission badge; controlled permission grant from enable toggle; real module-worker showNotification spy for full/generic previews and per-chat replacement; draft preservation; mobile 320/393/709/1024px; own-directory worker; raw parse-failure log and immediate manual retry; optional worker 401; Telegram full/generic delivery, 200-character cap, extension-settings token isolation, failed notification badge, no retry reload persistence, explicit Send test and exact API errors; automatic timer resumes with an exhausted diagnostic quota and no new request logging.');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
