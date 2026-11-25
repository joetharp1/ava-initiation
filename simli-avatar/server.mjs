import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const root=process.env.STATE_ROOT||'/state';
const origin=process.env.PUBLIC_ORIGIN;
const auth='Basic '+Buffer.from(`${process.env.ST_USER}:${process.env.ST_PASSWORD}`).toString('base64');
if(!origin||!process.env.ST_USER||!process.env.ST_PASSWORD)throw Error('Authentication configuration missing');
fs.mkdirSync(root,{recursive:true,mode:0o700});
const file=path.join(root,'simli.json');
let config=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{apiKey:'',faces:{}};
const remote=process.env.NODE_ENV==='test'?process.env.TEST_SIMLI_URL:'https://api.simli.ai';
let tokenBusy=false,lastToken=0;
function save(){fs.writeFileSync(file+'.tmp',JSON.stringify(config),{mode:0o600});fs.renameSync(file+'.tmp',file);}
function avatar(v){if(typeof v!=='string'||!v.endsWith('.png')||v.includes('/')||v.includes('\\')||v.includes('..')||v.length>250)throw Error('Select a single companion chat first.');return v;}
async function api(route,method='GET',body,key=config.apiKey){
 if(!key)throw Error('Save your Simli API key first.');
 const r=await fetch(remote+route,{method,headers:{'x-simli-api-key':key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(`Simli returned HTTP ${r.status}. Check your key, face availability and account minutes.`);
 return r.json();
}
async function faces(key){const r=await api('/faces','GET',null,key);if(!Array.isArray(r))throw Error('Unexpected face list response.');return r.filter(f=>!f.is_deleted).map(f=>({id:f.id,name:f.name||f.id,version:f.simli_version}));}
async function dispatch(route,b){
 if(route==='/status')return {configured:!!config.apiKey,faces:config.faces};
 if(route==='/key'){
  if(typeof b.apiKey!=='string'||b.apiKey.trim().length<10||b.apiKey.length>4096)throw Error('Enter your Simli API key.');
  const key=b.apiKey.trim(),list=await faces(key);config.apiKey=key;save();return {configured:true,faces:list};
 }
 if(route==='/faces')return {faces:await faces()};
 if(route==='/assign'){
  const a=avatar(b.avatar),list=await faces(),face=list.find(f=>f.id===b.faceId);
  if(!face)throw Error('Choose one of your available Simli faces.');
  config.faces[a]={id:face.id,name:face.name};save();return {ok:true,face:config.faces[a]};
 }
 if(route==='/token'){
  const a=avatar(b.avatar),face=config.faces[a];if(!face)throw Error('Assign a Simli face to this companion first.');
  if(tokenBusy||Date.now()-lastToken<10000)throw Error('Please wait ten seconds before starting another session.');
  tokenBusy=true;lastToken=Date.now();
  try{const r=await api('/compose/token','POST',{faceId:face.id,maxSessionLength:300,maxIdleTime:60,handleSilence:true,audioInputFormat:'pcm16',streaming_width:768,streaming_height:768});
   if(typeof r.session_token!=='string')throw Error('Simli did not return a session token.');
   return {session_token:r.session_token,maxSessionLength:300};
  }finally{tokenBusy=false;}
 }
 throw Error('Unknown endpoint.');
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const incoming=Buffer.from(req.headers.authorization||''),expected=Buffer.from(auth);
 if(incoming.length!==expected.length||!crypto.timingSafeEqual(incoming,expected)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="SillyTavern"'});res.end();return;}
 if(req.method!=='POST'||req.headers['x-astra-avatar']!=='1'||req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end();return;}
 const p=new URL(req.url,origin).pathname;
 if(!p.startsWith('/astra-avatar/')){res.writeHead(404);res.end();return;}
 try{let raw='';for await(const c of req){raw+=c;if(raw.length>12000)throw Error('Request too large.');}
  const out=await dispatch(p.slice('/astra-avatar'.length),JSON.parse(raw||'{}'));
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(out));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message.startsWith('Simli ')||/^(Select|Save|Enter|Unexpected|Choose|Assign|Please|Unknown|Request)/.test(e.message)?e.message:'Avatar request failed. Please try again.'}));}
});
server.listen(Number(process.env.PORT)||8788,'0.0.0.0',()=>console.log('Avatar bridge ready; configured: '+!!config.apiKey));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
