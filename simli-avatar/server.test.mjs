import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
test('private key storage, face ownership, authentication and bounded token generation',async()=>{
 const face='0067e65b-1111-2222-3333-444444444444';let tokens=0;
 const mock=http.createServer(async(req,res)=>{assert.equal(req.headers['x-simli-api-key'],'test-secret-api-key');res.setHeader('Content-Type','application/json');if(req.url==='/faces'){res.end(JSON.stringify([{id:face,name:'Face 0067e65b',simli_version:2}]));return;}let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);assert.equal(body.faceId,face);assert.equal(body.maxSessionLength,300);assert.equal(body.maxIdleTime,60);tokens++;res.end(JSON.stringify({session_token:'temporary-session'}));});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'simli-test-'));
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,NODE_ENV:'test',TEST_SIMLI_URL:'http://127.0.0.1:'+mock.address().port,STATE_ROOT:root,ST_USER:'test',ST_PASSWORD:'password',PUBLIC_ORIGIN:'http://localhost',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),5000);child.stdout.once('data',()=>{clearTimeout(t);resolve();});child.once('exit',()=>reject(Error('early exit')));});
  const call=async(route,body={},headers={})=>{const r=await fetch('http://127.0.0.1:'+port+'/astra-avatar/'+route,{method:'POST',headers:{Authorization:'Basic '+Buffer.from('test:password').toString('base64'),'X-Astra-Avatar':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
  assert.equal((await call('status',{}, {Authorization:'bad'})).status,401);
  assert.equal((await call('status',{}, {Origin:'https://other.example'})).status,403);
  assert.equal((await call('key',{apiKey:'test-secret-api-key'})).status,200);
  assert.equal(fs.statSync(path.join(root,'simli.json')).mode&0o777,0o600);
  assert.ok(!(await call('status')).text.includes('test-secret'));
  assert.equal((await call('assign',{avatar:'Mollie.png',faceId:'not-owned'})).status,400);
  assert.equal((await call('assign',{avatar:'../Mollie.png',faceId:face})).status,400);
  assert.equal((await call('assign',{avatar:'Mollie.png',faceId:face})).status,200);
  assert.equal((await call('token',{avatar:'Ava.png'})).status,400);
  assert.equal(tokens,0);
  assert.equal((await call('token',{avatar:'Mollie.png'})).status,200);
  assert.equal((await call('token',{avatar:'Mollie.png'})).status,400);
  assert.equal(tokens,1);
 }finally{child.kill();mock.closeAllConnections();await new Promise(r=>mock.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
