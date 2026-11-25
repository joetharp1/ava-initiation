import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {safeName,quietAt,repeatText,signature,atomicWrite,readChat,eligible,validateSnapshot} from '../server/core.mjs';

test('reject traversal and cross-profile paths; permit real companion names',()=>{
 for(const s of ['../Ava','a/b','a\\b','..','',null])assert.throws(()=>safeName(s));
 assert.equal(safeName('Eve March.png'),'Eve March.png');assert.equal(safeName('Ríona.png'),'Ríona.png');
});
test('quiet hours support overnight, equal times, and London daylight saving',()=>{
 assert.equal(quietAt(Date.parse('2026-11-25T04:00:00Z'),'23:00','08:00'),true);
 assert.equal(quietAt(Date.parse('2026-11-25T12:00:00Z'),'23:00','08:00'),false);
 assert.equal(quietAt(Date.parse('2026-07-01T22:30:00Z'),'23:00','08:00'),true);
 assert.equal(quietAt(Date.now(),'00:00','00:00'),false);
});
test('exact and close repeats rejected, fresh text accepted',()=>{
 assert(repeatText('How was your day?',['How was your day?']));
 assert(repeatText('I was thinking about that little cafe we talked about and wondered whether you fancied visiting.',['I was thinking about that little cafe we talked about and wondered whether you fancied visiting tomorrow.']));
 assert(!repeatText('I found a new book that reminded me of our conversation.',['How was your day?']));
 assert(!repeatText('I found a new book that reminded me of our conversation.',['','I','Hi','A photo.']));
});
test('no daily quota or reply gate; pacing, pause and quiet hours remain',()=>{
 const now=Date.parse('2026-11-25T04:00:00Z');const t={enabled:true,snapshot:{},nextAt:now-1,quietStart:'23:00',quietEnd:'08:00'};
 assert(!eligible(t,now));assert(eligible({...t,test:true},now));
 assert(eligible({...t,test:true,awaitingReply:true,dayCount:100},now));
 assert(!eligible({...t,test:true,nextAt:now+60000},now));assert(!eligible({...t,test:true,job:{}},now));
 assert(!eligible({...t,test:true,enabled:false},now));
});
test('atomic receipts and history signatures protect identity and exact text',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'init-core-'));const rows=[{chat_metadata:{}},{name:'Joe',is_user:true,mes:'Hello'},{name:'Mollie',is_user:false,mes:'Hi there'}];
 fs.mkdirSync(path.join(dir,'chats','Mollie'),{recursive:true});fs.writeFileSync(path.join(dir,'chats','Mollie','chat.jsonl'),rows.map(x=>JSON.stringify(x)).join('\n'));
 const c=readChat(dir,'Mollie.png','chat');assert.equal(c.signature,signature(rows));assert.equal(c.rows.length,2);
 assert.notEqual(signature(c.rows),signature([...c.rows,{mes:'Extra'}]));
 const file=path.join(dir,'state.json');atomicWrite(file,{id:'one'});atomicWrite(file,{id:'two'});assert.equal(JSON.parse(fs.readFileSync(file)).id,'two');
 assert.equal(fs.statSync(file).mode&0o777,0o600);fs.rmSync(dir,{recursive:true});
});
test('snapshot binds actual saved history and Venice endpoint',()=>{
 const chat={signature:'s',hash:'h',rows:[{is_user:false,mes:'Complete reply'}]};
 const p={signature:'s',chatHash:'h',params:{messages:[{role:'system',content:'Character'},{role:'assistant',content:'Complete reply'}],chat_completion_source:'custom',custom_url:'https://api.venice.ai/api/v1'}};
 assert(validateSnapshot(p,chat));assert.throws(()=>validateSnapshot({...p,chatHash:'old'},chat));
 assert.throws(()=>validateSnapshot({...p,params:{...p.params,custom_url:'http://127.0.0.1/admin'}},chat));
 assert.throws(()=>validateSnapshot(p,{...chat,rows:[{is_user:true,mes:'Still waiting'}]}));
});

test('captured history accepts append-only follow-ups, but rejects edits and truncation',async()=>{
 const {rowKeys,appendOnlyDelta,recoverRowKeys,parseInitiation}=await import('../server/core.mjs');
 const rows=[{is_user:true,mes:'Hi'},{is_user:false,mes:'Hello'}],snapshot={rowKeys:rowKeys(rows)};
 assert.equal(appendOnlyDelta(snapshot,{rows:[...rows,{is_user:false,mes:'A fresh thought'}]}).length,1);
 assert.throws(()=>appendOnlyDelta(snapshot,{rows:[rows[0],{is_user:false,mes:'Edited'}]}));
 assert.throws(()=>appendOnlyDelta(snapshot,{rows:[rows[0]]}));
 const old={chatHash:'old',params:{messages:[{role:'user',content:'Hi'},{role:'assistant',content:'Hello'}]}};
 assert.deepEqual(recoverRowKeys(old,{hash:'new',rows:[...rows,{is_user:true,mes:'Next'}]}),rowKeys(rows));
 assert.equal(recoverRowKeys(old,{hash:'new',rows:[...rows,...rows]}),null);
 assert.deepEqual(parseInitiation('{"text":"Hello again","imagePrompt":null}'),{text:'Hello again',imagePrompt:null});
 assert.throws(()=>parseInitiation('{bad json'));assert.throws(()=>parseInitiation('{"text":""}'));
});
