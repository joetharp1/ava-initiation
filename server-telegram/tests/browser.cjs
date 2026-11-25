const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'..');
const mocks={
 '/script.js':`export const event_types=Object.fromEntries(['CHAT_CHANGED','GENERATION_STARTED','GENERATION_ENDED','MESSAGE_SENT','GENERATE_AFTER_DATA','CHAT_COMPLETION_SETTINGS_READY'].map(x=>[x,x])); const hooks={};export const eventSource={on(n,f){(hooks[n]||=[]).push(f)},makeLast(n,f){this.on(n,f)},removeListener(n,f){hooks[n]=(hooks[n]||[]).filter(x=>x!==f)},async emit(n,...a){for(const f of hooks[n]||[])await f(...a)}};export const isGenerating=()=>false;export function updateMessageBlock(i,m){const p=document.querySelector('[data-msg="'+i+'"]');p.textContent=m.mes;p.classList.toggle('inline_media',!!m.extra?.media?.length&&m.extra.inline_image===false)};export const addOneMessage=m=>{globalThis.rendered.push(m);const p=document.createElement('p');p.className='mes_text';p.dataset.msg=String(fixture.chat.indexOf(m));document.body.appendChild(p);updateMessageBlock(fixture.chat.indexOf(m),m)};globalThis.fixtureHost={addOneMessage,updateMessageBlock};export async function Generate(t,o,d){if(!d)throw Error('No paid browser generation');await eventSource.emit('GENERATE_AFTER_DATA',{prompt:[{role:'system',content:'Fixture'},{role:'assistant',content:'Hello'}]},true)}`,
 '/scripts/extensions.js':`globalThis.rendered=[];globalThis.fixture={characterId:0,characters:[{avatar:'Mollie.png'}],chatId:'chat',name2:'Mollie',chat:[],async saveChat(){await fetch('/save',{method:'POST',body:JSON.stringify(this.chat)})},async reloadCurrentChat(){}};export const getContext=()=>fixture;`,
 '/scripts/openai.js':`export const oai_settings={};export const getChatCompletionModel=()=> 'fixture';export const createGenerationParameters=async(c,m,t,p)=>({generate_data:{messages:p}});`,
 '/scripts/constants.js':`export const MEDIA_TYPE={IMAGE:'image'},MEDIA_SOURCE={GENERATED:'generated'},MEDIA_DISPLAY={GALLERY:'gallery'};`
};
let queue=[],saved=[],acks=[];
(async()=>{
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','text/javascript');
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{font:16px sans-serif}button{max-width:100%;margin:3px}#extensions_settings{max-width:100%}.inline_media{display:none}</style><div id="extensions_settings"></div><textarea id="send_textarea"></textarea><script type="module" src="/scripts/extensions/third-party/astra-server-initiation/index.js"></script>');return;}
  if(mocks[req.url]){res.end(mocks[req.url]);return;}
  if(req.url.endsWith('/index.js')){res.end(fs.readFileSync(path.join(root,'client/index.js')));return;}
  let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');
  if(req.url==='/save'){saved=b;res.end('{}');return;}
  if(req.url.endsWith('/status')){res.end(JSON.stringify({targets:[{avatar:'Mollie.png',chatId:'chat',name:'Mollie',enabled:true,nextAt:Date.now()+3600000,min:60,max:120,pendingCount:queue.length,imagesEnabled:true,contextReady:true}]}));return;}
  if(req.url.endsWith('/inbox')){res.end(JSON.stringify({pending:queue[0]||null}));return;}
  if(req.url.endsWith('/claim')){res.end(JSON.stringify({lease:'fixture',pending:queue[0]}));return;}
  if(req.url.endsWith('/ack')){const p=queue[0],m=saved.find(m=>m.extra?.server_initiation?.id===p.id);assert.equal(m.mes,p.text);if(p.imageUrl)assert.equal(m.extra.media[0].url,p.imageUrl);acks.push(b.id);queue.shift();res.end('{}');return;}
  if(req.url.endsWith('/baseline')){const signature=require('node:crypto').createHash('sha256').update(JSON.stringify(saved.filter(m=>typeof m?.mes==='string').map(m=>[!!m.is_user,!!m.is_system,m.mes,m.extra?.media?.map(p=>p.url)||[],m.extra?.tool_invocations||[]]))).digest('hex');res.end(JSON.stringify({signature,chatHash:'fixture',sourceHash:'fixture'}));return;}
  res.end('{}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--disable-gpu']});
 try{const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('[data-action="import"]');
 queue=[{id:'one',text:'A fresh thought.',createdAt:Date.now()},{id:'two',text:'A new picture.',imageUrl:'/user/images/Mollie/two.png',createdAt:Date.now()+1}];
 await page.locator('[data-action="import"]').click();await page.waitForFunction(()=>fixture.chat.length===2);await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('0 waiting'));
 assert.deepEqual(acks,['one','two']);assert.equal(await page.evaluate(()=>rendered.length),2);assert.equal(await page.evaluate(()=>fixture.chat[1].extra.media[0].type),'image');
 assert.equal(await page.locator('[data-msg="1"]').isVisible(),true,'new image message keeps its Telegram text visible');
 await page.evaluate(async()=>{fixture.chat[1].extra.inline_image=false;fixtureHost.updateMessageBlock(1,fixture.chat[1]);await fixture.saveChat()});
 assert.equal(await page.locator('[data-msg="1"]').isVisible(),false,'native ST hide flag reproduces the original bug');
 await page.locator('[data-action="import"]').click();await page.waitForFunction(()=>fixture.chat[1].extra.inline_image===true);
 assert.equal(await page.locator('[data-msg="1"]').isVisible(),true,'existing hidden message is repaired and rendered');
 assert.equal(saved[1].mes,'A new picture.');assert.equal(saved[1].extra.media[0].url,'/user/images/Mollie/two.png');assert.equal(saved[1].extra.inline_image,true);
 await page.locator('[data-action="import"]').click();assert.equal(saved.length,2);
 for(const width of [320,393,709,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 assert.deepEqual(errors,[]);console.log('Browser: ordered text/image imports, exact receipts, no duplicate append, four viewport sizes passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
