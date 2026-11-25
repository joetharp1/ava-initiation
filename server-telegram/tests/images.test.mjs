import test from 'node:test';
import assert from 'node:assert/strict';
import {generateStill,imageSettings} from '../server/images.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNDsAAAAASUVORK5CYII=','base64');
const settings={extension_settings:{'st-venice-vision-bridge':{enabled:true,characters:{'Mollie.png':true},portraits:{'Mollie.png':{url:'/user/files/mollie.png',model:'test-edit'},'Ava.png':{url:'/user/files/ava.png',model:'test-edit'}},editModels:[{id:'test-edit',constraints:{promptCharacterLimit:3000,qualities:[],aspectRatios:[],resolutions:[]},pricing:{inpaint:{usd:.1}}}]},'st-venice-image':{api_key:'synthetic-key',safe_mode:true}}};
const modulePath=process.env.VENICE_PORTRAITS_MODULE || new URL('../../venice-video-work/portraits.mjs',import.meta.url).pathname;
test('image uses only selected companion reference, reserves before charge, saves locally and never calls video or Telegram',async()=>{
 const calls=[];let reserved=false,uploaded=false;
 const result=await generateStill({root:'/unused',modulePath,origin:'https://example.test',auth:'Basic synthetic',avatar:'Mollie.png',prompt:'Reading a book in a sunny room',settings,
 reserve:cost=>{assert.equal(cost,.1);reserved=true;},upload:async img=>{uploaded=true;assert.equal(img.extension,'png');return '/user/images/Mollie/one.png';},request:async(url,opts)=>{
  calls.push(url);
  if(url.startsWith('https://example.test')){assert.equal(url,'https://example.test/user/files/mollie.png');assert.equal(opts.redirect,'error');return new Response(png);}
  assert(reserved);assert.equal(url,'https://api.venice.ai/api/v1/image/edit');assert.equal(opts.headers.Authorization,'Bearer synthetic-key');const b=JSON.parse(opts.body);assert.equal(b.model,'test-edit');assert(b.image.startsWith('data:image/png;base64,'));return new Response(png);
 }});assert(uploaded);assert.equal(calls.length,2);assert.equal(result,'/user/images/Mollie/one.png');
});
test('disabled companion cannot use another companion image configuration',()=>{assert.equal(imageSettings(settings,'Eve.png'),null);});
test('foreign reference URL is rejected without sending auth or making any request',async()=>{
 const s=structuredClone(settings);s.extension_settings['st-venice-vision-bridge'].portraits['Mollie.png'].url='https://foreign.test/leak';let calls=0;
 await assert.rejects(()=>generateStill({root:'/unused',modulePath,origin:'https://example.test',auth:'secret',avatar:'Mollie.png',prompt:'A room',settings:s,reserve:()=>{},upload:()=>{},request:()=>{calls++;}}),/Invalid local reference/);assert.equal(calls,0);
});
