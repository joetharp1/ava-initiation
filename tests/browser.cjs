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
 let generating=false;export const isGenerating=()=>generating;export const saveSettingsDebounced=()=>{localStorage.setItem('fixture-settings',JSON.stringify(globalThis.fixtureSettings))};
 export function stopGeneration(){generating=false;eventSource.emit('stop')}
 export async function Generate(type,options){
 if(type!=='normal'||!options.automatic_trigger||!options.jsonSchema)throw Error('Wrong generation path');
 fixture.calls++;await eventSource.emit('commands',type,options,false);generating=true;
 try{const ev={chat:[{role:'system',content:'STATE TRACKER fixture: established relationship'},{role:'user',content:'The same previous question'}]};await eventSource.emit('prompt',ev);const req={messages:ev.chat,temperature:0.65,stream:fixture.c.chatCompletionSettings.stream_openai};await eventSource.emit('request',req);fixture.request=req;
 if(req.stream||req.tools)throw Error('Streaming/tools were not suppressed');
 if(fixture.hang)await new Promise(r=>fixture.release=r);
 if(fixture.calls===2)req.messages.push({role:'user',content:'[Continue your last message without repeating its original content.]'});
 const response=await fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify(req)});return response.text();}finally{generating=false}}
 globalThis.fixture={calls:0,hang:false,c:{avatar:'A',characterId:0,characters:[{avatar:'A'}],chatId:'chat-a',name2:'Test Companion',chat:[],mainApi:'openai',chatCompletionSettings:{stream_openai:true,function_calling:true,prompts:[]},getCharacterCardFields:()=>({description:'A fictional adult companion.'}),substituteParams:x=>x,getTokenCountAsync:async x=>Math.ceil(x.length/3),addOneMessage(m){const p=document.createElement('p');p.className='message';p.textContent=m.mes;document.getElementById('chat').append(p)},saveChat:async()=>{}}};
 globalThis.host={eventSource,event_types};`,
};
const html=`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{font:16px system-ui;background:#202020;color:#eee;margin:12px}#extensions_settings{display:flex;flex-direction:column;width:100%}.inline-drawer-header{padding:12px;background:#333}.inline-drawer-content{display:block}input,select,button{font:inherit}input{color:inherit;background:white}button{cursor:pointer}#send_textarea{width:100%;height:60px}</style></head><body><div id="extensions_settings"></div><div id="following">Next extension</div><div id="chat"></div><textarea id="send_textarea"></textarea><script type="module" src="/scripts/extensions/third-party/ava-initiation/index.js"></script></body></html>`;
(async()=>{
 let networkCalls=0;
 const server=http.createServer((req,res)=>{
  const p=req.url.split('?')[0];
  if(p==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
  if(mocks[p]){res.setHeader('Content-Type','text/javascript');res.end(mocks[p]);return}
  if(p==='/scripts/extensions/third-party/ava-initiation/index.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'index.js')));return}
  if(p==='/api/backends/chat-completions/generate'){
   networkCalls++;req.resume();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:'Repeated fixture reply.'}));return;
  }
  res.statusCode=404;res.end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu'],headless:true});
 try{
  const context=await browser.newContext({viewport:{width:393,height:852}});const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#ava-diagnose').waitFor();
  assert.equal(await page.locator('#ava-fire').isDisabled(),true);assert.equal(networkCalls,0);
  await page.locator('#ava-allow').check();await page.waitForTimeout(100);
  await page.locator('[data-setting=enabled]').check();await page.waitForTimeout(100);
  assert.equal(networkCalls,0,'enabling must not fire during diagnostic hold');
  await page.locator('#send_textarea').fill('Unfinished draft');await page.locator('#ava-diagnose').click();
  assert.equal(networkCalls,0);assert.match(await page.locator('#ava-diagnostic-status').innerText(),/0\/2/);
  await page.locator('#send_textarea').fill('');
  const originalFetch=await page.evaluate(()=>{globalThis.fetchBeforeDiagnostic=fetch;return true});assert.ok(originalFetch);
  await page.locator('#ava-diagnose').click();
  await page.waitForFunction(()=>document.querySelector('#ava-diagnostic-status').textContent.startsWith('2/2')&&document.querySelectorAll('.message').length===2);
  await page.waitForTimeout(200);
  assert.equal(networkCalls,2);assert.equal(await page.locator('#ava-diagnose').isDisabled(),true);
  assert.equal(await page.evaluate(()=>fetch===fetchBeforeDiagnostic),true,'fetch interceptor restored');
  assert.equal(await page.evaluate(()=>fixture.c.chat.filter(m=>m.is_user).length),0);
  assert.equal(await page.evaluate(()=>fixture.c.chatCompletionSettings.function_calling),true);
  assert.equal(await page.evaluate(()=>fixture.c.chatCompletionSettings.stream_openai),true);
  const report=JSON.parse(await page.locator('#ava-diagnostic-report').inputValue());
  assert.equal(report.attempts.length,2);assert.equal(report.identicalOutputs,true);assert.equal(report.held,true);
  const first=report.attempts[0].request, second=report.attempts[1].request;
  assert.equal(first.request.instruction.last,true);assert.equal(first.request.finalRole,'system');assert.equal(first.request.nudges.length,0);
  assert.equal(second.assembly.instruction.last,true);assert.equal(second.request.instruction.last,false);
  assert.equal(second.request.finalRole,'user');assert.equal(second.request.nudges[0].relativeToInstruction,'after');
  assert.equal(second.nudgeAddedAfterAssembly.length,1);
  assert.equal(first.request.temperature,.65);assert.equal(second.request.temperature,.65,'no temperature fix before evidence');
  assert.equal(first.historyEntries,0);assert.equal(second.historyEntries,1);
  for(const a of report.attempts){assert.notEqual(a.type,'photo');assert.ok(a.request.request.messages.every(m=>Array.from(m.first120).length<=120));assert.ok(a.outcomes.some(r=>r.outcome==='sent'))}
  assert.equal(await page.locator('#ava-unread-float').isVisible(),true);
  const stamp=await page.evaluate(()=>({now:Date.now(),sent:fixture.c.chat[0].send_date}));assert.ok(Math.abs(stamp.now-stamp.sent)<10000);
  // Copy works without a desktop console. Clipboard shim is used on this build.
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{globalThis.copied=text}}}));
  await page.locator('#ava-copy-diagnostics').click();
  assert.deepEqual(JSON.parse(await page.evaluate(()=>copied)).attempts,report.attempts);
  for(const width of [320,393,709,1024]){
   await page.setViewportSize({width,height:852});const bounds=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,height:document.querySelector('.ava-body').getBoundingClientRect().height,button:document.querySelector('#ava-diagnose').getBoundingClientRect().height}));
   assert.ok(bounds.width<=bounds.viewport);assert.ok(bounds.height<=554);assert.ok(bounds.button>=44);
  }
  // Hold persists after reload and can't be bypassed by a second tab.
  await page.reload();await page.locator('#ava-diagnose').waitFor();assert.equal(await page.locator('#ava-diagnose').isDisabled(),true);
  const secondTab=await context.newPage();await secondTab.goto(url);await secondTab.locator('#ava-diagnose').waitFor();
  assert.equal(await secondTab.locator('#ava-diagnose').isDisabled(),true);assert.equal(await secondTab.locator('#ava-fire').isDisabled(),true);
  await page.waitForTimeout(5200);assert.equal(networkCalls,2);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS diagnostic browser harness: actual fetch-boundary capture of two mock requests, late-nudge detection, unchanged prompt role/temperature, history comparison, output equality, draft protection, text-only attempts, restored fetch/settings, copy report, mobile layouts, persisted hold across reload/tabs and no third request. Synthetic fixture evidence only; not live ST findings.');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
