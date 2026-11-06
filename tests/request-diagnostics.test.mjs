import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectInitiationRequest, diagnosticFetch, createEngine, MINUTE } from '../index.js';
import { fixture } from './helpers.mjs';
const instruction = 'Initiate a new opening. No headers.';
test('diagnostic records every role and first 120 characters without mutating messages', () => {
    const data = { temperature: .7, messages: [{role:'user',content:'x'.repeat(150)}, {role:'system',content:instruction}] };
    const before = structuredClone(data), report = inspectInitiationRequest(data, instruction);
    assert.deepEqual(data, before); assert.equal(report.messages[0].first120.length, 120);
    assert.deepEqual(report.instruction, {present:true,indices:[1],last:true,role:'system'});
    assert.equal(report.finalRole,'system'); assert.equal(report.endsOnUser,false); assert.equal(report.temperature,.7);
    assert.deepEqual(report.nudges,[]);
});
test('configured continue and impersonation nudges report exact positions relative to ours', () => {
    const report = inspectInitiationRequest({messages:[{role:'system',content:'Become Joe'},
        {role:'system',content:instruction},{role:'user',content:'Continue now'}]}, instruction,
        {continue_nudge_prompt:'Continue now',impersonation_prompt:'Become {{user}}'}, s=>s.replace('{{user}}','Joe'));
    assert.deepEqual(report.nudges.map(n=>[n.kind,n.index,n.relativeToInstruction]),[['impersonation',0,'before'],['continue',2,'after']]);
    assert.equal(report.instruction.last,false); assert.equal(report.endsOnUser,true);
});
test('missing instruction, custom body override and assistant prefill remain explicit', () => {
    const report = inspectInitiationRequest({messages:[],custom_include_body:'{"temperature":0,"messages":[]}',assistant_prefill:'Next:'},instruction);
    assert.equal(report.instruction.present,false); assert.equal(report.instruction.last,false);
    assert.equal(report.customMessagesOverride,true); assert.equal(report.customTemperature,0); assert.equal(report.assistantPrefill,'Next:');
});
test('multimodal diagnostic includes text only, never image URLs or binary data', () => {
    const report = inspectInitiationRequest({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'secret-image'}},{type:'text',text:'caption'}]}]},instruction);
    assert.equal(report.messages[0].first120,'caption'); assert.ok(!JSON.stringify(report).includes('secret-image'));
});
test('fetch boundary sees late mutations and forwards the original body unchanged', async () => {
    let captured, forwarded;
    const fetch = diagnosticFetch(async (...args)=>{forwarded=args;return 'response'}, data=>{captured=inspectInitiationRequest(data,instruction)});
    const data={messages:[{role:'system',content:instruction}]};
    data.messages.push({role:'user',content:'[Continue your last message without repeating its original content.]'});
    const options={method:'POST',body:JSON.stringify(data)};
    assert.equal(await fetch('/api/backends/chat-completions/generate',options),'response');
    assert.equal(captured.finalRole,'user'); assert.equal(captured.nudges[0].relativeToInstruction,'after');
    assert.equal(forwarded[1],options); assert.deepEqual(JSON.parse(forwarded[1].body),data);
});
test('fetch interception ignores Telegram and blocks malformed generation body before dispatch', async () => {
    let sent=0,captures=0;const fetch=diagnosticFetch(async()=>{sent++},()=>{captures++});
    await fetch('https://api.telegram.org/botFAKE/sendMessage',{method:'POST',body:'other'});
    assert.equal(sent,1);assert.equal(captures,0);
    await assert.rejects(fetch('/api/backends/chat-completions/generate',{method:'POST',body:'bad JSON'}));assert.equal(sent,1);
});
test('diagnostic holds ordinary ticks, reserves at most two text attempts across engines and survives reply',async()=>{
    const diag={chat:null,attempts:[]};const d={diagnosticHold:()=>true,
        canDiagnose:c=>diag.attempts.length<2&&(!diag.chat||diag.chat===c.chatId),
        reserveDiagnostic:(c,a)=>{diag.chat=c.chatId;diag.attempts.push(a.id)}};
    const f=fixture(d);await f.engine.tick(true);f.advance(3*MINUTE);await f.engine.tick();assert.equal(f.deliveries.length,0);
    await f.engine.tick(true,true);assert.equal(f.deliveries.length,1);assert.notEqual(f.deliveries[0].type,'photo');
    const reload=createEngine(f.d);await reload.tick(true,true);await reload.tick(true,true);
    assert.equal(diag.attempts.length,2);assert.equal(f.deliveries.length,2);
    f.c.chat.push({is_user:true,mes:'reply'});await reload.reply(f.c.chat.length-1);await reload.tick(true);await reload.tick(true,true);
    assert.equal(f.deliveries.length,2);
});
test('deferred diagnostics consume no slot and failed attempts still consume one',async()=>{
    let used=0;const f=fixture({diagnosticHold:()=>true,canDiagnose:()=>used<2,reserveDiagnostic:()=>used++,deliver:async()=>{throw Error('provider failed')}});
    f.block(true);await f.engine.tick(true,true);assert.equal(used,0);
    f.block(false);await f.engine.tick(true,true);await f.engine.tick(true,true);await f.engine.tick(true,true);
    assert.equal(used,2);assert.equal(f.db.log.filter(r=>r.outcome==='failed').length,2);
});
