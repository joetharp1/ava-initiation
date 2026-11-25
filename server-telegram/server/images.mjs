import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Reuse the installed image bridge's exact reference/model request builder.
// No video module or general tool executor is imported.
export function imageSettings(settings,avatar){
    const own=settings.extension_settings?.['st-venice-vision-bridge'];
    const legacy=settings.extension_settings?.['st-venice-image'];
    const ref=own?.portraits?.[avatar];
    return own?.enabled&&own.characters?.[avatar]&&ref?.url&&legacy?.api_key
        &&own.editModels?.some(m=>m.id===ref.model&&!m.offline)?{own,legacy}:null;
}
export async function generateStill({root,origin,auth,avatar,prompt,settings,upload,reserve,request=fetch,modulePath}){
    const config=imageSettings(settings,avatar);if(!config)throw Error('Image reference not configured.');
    const file=modulePath||path.join(root,'extensions/st-venice-vision-bridge/portraits.mjs');
    const {portraitPlan,attachPortrait,editedImage,referenceCostUsd}=await import(pathToFileURL(file));
    const plan=portraitPlan(config.own,avatar,config.legacy,{prompt});
    const endpoint=new URL(plan.endpoint);
    if(endpoint.origin!=='https://api.venice.ai'||!['/api/v1/image/edit','/api/v1/image/multi-edit'].includes(endpoint.pathname))throw Error('Invalid still image endpoint.');
    const price=referenceCostUsd(config.own,avatar);
    if(!Number.isFinite(price)||price<0)throw Error('Reference image price unavailable.');
    const ref=new URL(plan.url,origin);
    if(ref.origin!==origin||!/^\/(user\/files|user\/images)\//.test(ref.pathname)||ref.username||ref.password)throw Error('Invalid local reference.');
    const r=await request(ref.href,{headers:{Authorization:auth},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error('Could not load reference.');
    if(Number(r.headers.get('content-length'))>8*1024*1024)throw Error('Oversized reference.');
    const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>8*1024*1024)throw Error('Oversized reference.');
    const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes[0]===255&&bytes[1]===216?'jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
    if(!mime)throw Error('Unsupported reference format.');
    const body=attachPortrait(plan,'data:image/'+mime+';base64,'+bytes.toString('base64'));
    reserve(price); // Durable receipt immediately before the one paid request.
    const response=await request(plan.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.legacy.api_key},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error('Still image provider returned HTTP '+response.status);
    const image=await editedImage(response);
    return upload(image);
}
