import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness() {
  const nodes=new Map(), handlers={}, calls=[], clients=[], sdkOptions=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,checked:true,value:'',textContent:'',disabled:false,muted:false,volume:1,srcObject:null,pause(){this.paused=true;},play(){return Promise.resolve();}});return nodes.get(id);};
  node('tts_audio').muted=false;
  let who={name:'Astra',avatar:'Astra.png'}, tokenGate=null;
  const context={groupId:null,characterId:0,chatId:'chat-one',get characters(){return [who];},eventTypes:{TTS_AUDIO_READY:'tts',CHAT_CHANGED:'chat',GENERATION_STARTED:'generation'},eventSource:{on(name,fn){handlers[name]=fn;}}};
  const events={CONNECTION_CLOSED:'closed',VIDEO_STREAM_STARTED:'stream',VIDEO_PLAY_STARTED:'play'};
  class FakeClient {
    constructor(){this.listeners={};this.stops=0;this.interrupts=0;clients.push(this);}
    addListener(name,fn){this.listeners[name]=fn;}
    async streamToVideoElement(){this.listeners.stream?.();this.listeners.play?.();}
    async stopStreaming(){this.stops++;this.listeners.closed?.();}
    interruptPersona(){this.interrupts++;}
  }
  const sandbox={console,AbortSignal,Blob,Uint8Array,DataView,Promise,setTimeout,clearTimeout,jQuery(fn){sandbox.init=fn;},getContext:()=>context,AnamEvent:events,createClient(token,options){sdkOptions.push(options);return new FakeClient();},document:{hidden:false,getElementById(id){if(id==='astra-anam')return null;if(id==='astra-simli-start')return {disabled:false};return node(id);},createElement(){return {innerHTML:'',className:''};},querySelector(){return {append(){}};},addEventListener(name,fn){handlers[name]=fn;}},window:{addEventListener(name,fn){handlers[name]=fn;}},fetch:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});
    if(url.endsWith('/token') && tokenGate)await tokenGate;
    let data={};
    if(url.endsWith('/status'))data={configured:false,faces:{},suggestedAstraId:'test-avatar'};
    if(url.endsWith('/token'))data={sessionToken:'test-ephemeral-token',leaseId:'test-lease',maxSeconds:180};
    return {ok:true,json:async()=>data};
  }};
  vm.createContext(sandbox);
  const source=fs.readFileSync(new URL('./client.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,sandbox);sandbox.init();
  return {sandbox,calls,clients,sdkOptions,node,handlers,run:code=>vm.runInContext(code,sandbox),setWho:value=>{who=value;},setGate:value=>{tokenGate=value;}};
}
const settle=()=>new Promise(r=>setTimeout(r,0));

test('setup is silent; explicit start disables capture; stop restores TTS without recursive cleanup',async()=>{
  const h=harness();await settle();
  assert.equal(h.clients.length,0);
  assert.equal(h.calls.some(x=>x.url.endsWith('/token')),false);
  h.node('astra-anam-key').value='private-value';
  await h.node('astra-anam-savekey').onclick();
  assert.equal(h.node('astra-anam-key').value,'');
  assert.equal(h.clients.length,0);
  await h.run('start()');
  assert.equal(h.sdkOptions[0].disableInputAudio,true);
  assert.equal(h.node('astra-anam-video').muted,true);
  assert.equal(h.node('astra-anam-video').volume,0);
  assert.equal(h.node('tts_audio').muted,true);
  h.node('astra-anam-muted').checked=false;h.node('astra-anam-muted').onchange();
  assert.equal(h.node('astra-anam-video').muted,false);
  await h.run('stop()');
  assert.equal(h.clients[0].stops,1);
  assert.equal(h.node('tts_audio').muted,false);
  assert.equal(h.node('tts_audio').paused,true);
  assert.equal(h.node('astra-anam-video').muted,true);
  assert.equal(h.node('astra-anam-start').disabled,false);
});

test('stopping during token request never connects and releases the unused lease',async()=>{
  const h=harness();await settle();let resolve;
  h.setGate(new Promise(r=>{resolve=r;}));
  const started=h.run('start()');await settle();await h.run('stop()');resolve();await started;
  assert.equal(h.clients.length,0);
  assert.equal(h.calls.filter(x=>x.url.endsWith('/release')).length,1);
  assert.equal(h.node('tts_audio').muted,false);
});

test('chat changes stop the old avatar; background/pagehide never reconnect',async()=>{
  const h=harness();await settle();await h.run('start()');
  h.setWho({name:'Eve',avatar:'Eve.png'});h.handlers.chat();await settle();
  assert.equal(h.clients[0].stops,1);
  assert.equal(h.node('astra-anam-companion').textContent,'Eve');
  assert.equal(h.calls.filter(x=>x.url.endsWith('/token')).length,1);
  h.handlers.pagehide();await settle();
  assert.equal(h.calls.filter(x=>x.url.endsWith('/token')).length,1);
});
