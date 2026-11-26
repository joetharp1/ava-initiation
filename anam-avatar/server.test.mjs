import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

test('private setup, safe avatar assignment and bounded audio-only session', async() => {
  const faceId='11111111-2222-3333-4444-555555555555';
  let tokens=0, tokenBody, mockError=false;
  const mock=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.headers.authorization!=='Bearer test-private-api-key') {res.writeHead(401);res.end('{}');return;}
    if(mockError) {res.writeHead(500);res.end(JSON.stringify({error:'test-private-api-key upstream secret'}));return;}
    if(req.url==='/v1/avatars/'+faceId) {res.end(JSON.stringify({id:faceId,displayName:'Test avatar',activeVersion:'cara-4'}));return;}
    if(req.url==='/v1/auth/session-token') {let raw='';for await(const c of req)raw+=c;tokenBody=JSON.parse(raw);tokens++;res.end(JSON.stringify({sessionToken:'short-lived-token'}));return;}
    res.writeHead(404);res.end('{}');
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'anam-bridge-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,NODE_ENV:'test',TEST_ANAM_URL:'http://127.0.0.1:'+mock.address().port,STATE_ROOT:root,ST_USER:'test',ST_PASSWORD:'password',PUBLIC_ORIGIN:'https://st.example',PORT:String(port)},stdio:['ignore','pipe','pipe']});
  const exited=new Promise(r=>child.once('exit',r));
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout')),5000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(Error('server exited'));});});
    const call=async(route,body={},headers={})=>{
      const r=await fetch('http://127.0.0.1:'+port+'/astra-anam/'+route,{method:'POST',headers:{Authorization:'Basic '+Buffer.from('test:password').toString('base64'),'X-Astra-Anam':'1','Content-Type':'application/json',Origin:'https://st.example',...headers},body:JSON.stringify(body)});
      const text=await r.text();return {status:r.status,text,data:text?JSON.parse(text):null};
    };
    assert.equal((await call('status',{}, {Authorization:'bad'})).status,401);
    assert.equal((await call('status',{}, {Origin:'https://evil.example'})).status,403);
    assert.equal((await call('status',{}, {'X-Astra-Anam':'0'})).status,403);
    assert.equal((await call('status')).data.configured,false);
    assert.equal((await call('setup',{avatar:'../Test.png',faceId,apiKey:'test-private-api-key'})).status,400);
    assert.equal((await call('setup',{avatar:'Test.png',faceId:'../../anything',apiKey:'test-private-api-key'})).status,400);
    assert.equal((await call('setup',{avatar:'Test.png',faceId,apiKey:'bad-key-0000'})).status,400);
    assert.equal((await call('setup',{avatar:'Test.png',faceId,apiKey:'test-private-api-key'})).status,200);
    assert.equal(tokens,0,'saving a key must not mint tokens/start sessions');
    assert.equal(fs.statSync(path.join(root,'anam.json')).mode&0o777,0o600);
    const safe=await call('status');assert.ok(!safe.text.includes('test-private'));assert.equal(safe.data.faces['Test.png'].id,faceId);
    assert.equal((await call('assign',{avatar:'Other.png',faceId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'})).status,400);
    assert.equal((await call('token',{avatar:'Other.png'})).status,400);
    const token=await call('token',{avatar:'Test.png'});assert.equal(token.status,200);
    assert.equal(tokenBody.personaConfig.avatarId,faceId);
    assert.equal(tokenBody.personaConfig.avatarModel,'cara-4');
    assert.equal(tokenBody.personaConfig.enableAudioPassthrough,true);
    assert.equal(tokenBody.personaConfig.maxSessionLengthSeconds,180);
    assert.ok(!('personaId' in tokenBody.personaConfig));
    assert.ok(!('voiceId' in tokenBody.personaConfig));
    assert.deepEqual(tokenBody.sessionOptions.dataRetention,{recording:false,transcripts:false});
    assert.equal((await call('token',{avatar:'Test.png'})).status,400);
    await call('release',{leaseId:'wrong'});
    assert.equal((await call('token',{avatar:'Test.png'})).status,400);
    await call('release',{leaseId:token.data.leaseId});
    assert.match((await call('token',{avatar:'Test.png'})).text,/wait ten seconds/);
    mockError=true;
    const error=await call('assign',{avatar:'Test.png',faceId});assert.equal(error.status,400);assert.ok(!error.text.includes('test-private-api-key'));
    assert.equal(tokens,1);
  } finally {child.kill();await exited;mock.closeAllConnections();await new Promise(r=>mock.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
