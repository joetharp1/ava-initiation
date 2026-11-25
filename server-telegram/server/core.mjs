import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const signature = rows => hash(rows.filter(m => typeof m?.mes === 'string').map(m => [!!m.is_user, !!m.is_system, m.mes, m.extra?.media?.map(p => p.url) || [], m.extra?.tool_invocations || []]));
export function safeName(name) {
    if (typeof name !== 'string' || !name || name.length > 240 || name !== path.basename(name) || /[\\/\x00]/.test(name) || name === '.' || name === '..') throw new Error('Invalid chat identity.');
    return name;
}
export const targetId = (avatar, chatId) => hash([safeName(avatar), safeName(chatId)]).slice(0,32);
export function quietAt(now, start, end, timezone='Europe/London') {
    const t = new Intl.DateTimeFormat('en-GB', {timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));
    return start === end ? false : start < end ? t >= start && t < end : t >= start || t < end;
}
export function repeatText(text, previous) {
    const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
    const a = norm(text);
    return previous.some(p => {
        const b=norm(p); if(!b)return false;
        if(a===b || (Math.min(a.length,b.length)>35 && (b.includes(a)||a.includes(b)))) return true;
        const words=s=>new Set(s.split(' ').map((w,i,arr)=>arr.slice(i,i+3).join(' ')));
        const x=words(a),y=words(b),overlap=[...x].filter(w=>y.has(w)).length;
        return Math.min(a.length,b.length)>60 && overlap / Math.max(1,x.size+y.size-overlap) > .75;
    });
}
export function atomicWrite(file, value) {
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    const tmp=file+'.'+crypto.randomUUID()+'.tmp';
    const fd=fs.openSync(tmp,'wx',0o600);
    try {fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(tmp,file);
    const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
export function readChat(root, avatar, chatId) {
    safeName(avatar);safeName(chatId);
    const file=path.join(root,'chats',avatar.replace(/\.png$/i,''),chatId+'.jsonl');
    const raw=fs.readFileSync(file,'utf8');
    const all=raw.split('\n').filter(Boolean).map(s=>JSON.parse(s));
    return {file,raw,hash:hash(raw),rows:all.filter(m=>typeof m.mes==='string'),signature:signature(all)};
}
// The prompt is a frozen ST-assembled snapshot. Runtime settings, journals,
// generated media and other companions must not invalidate it.
export function sourceFingerprint(root, avatar) {
    const s=JSON.parse(fs.readFileSync(path.join(root,'settings.json'),'utf8'));
    const card=fs.readFileSync(path.join(root,'characters',safeName(avatar)));
    return hash([hash(card),s.username,s.user_avatar,s.power_user?.persona_description]);
}
export function rowKeys(rows) { return rows.map(m=>signature([m])); }
export function appendOnlyDelta(snapshot, chat) {
    const keys=rowKeys(chat.rows), base=snapshot.rowKeys;
    if(!Array.isArray(base) || base.some((k,i)=>keys[i]!==k)) throw new Error('Conversation history changed. Open this chat to refresh context.');
    const delta=chat.rows.slice(base.length);
    if(delta.length>100 || JSON.stringify(delta.map(m=>m.mes)).length>60000) throw new Error('Open this chat to refresh its extended conversation context.');
    return delta;
}
// Upgrade old snapshots by locating their final exact conversational pair.
// Never infer a base across an edit or a single ambiguous matching sentence.
export function recoverRowKeys(snapshot,chat) {
    if(snapshot.chatHash===chat.hash)return rowKeys(chat.rows);
    const msgs=snapshot.params?.messages?.filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string')||[];
    const tail=msgs.slice(-2);
    if(tail.length<2)return null;
    const hits=[], visible=chat.rows.map((r,index)=>({r,index})).filter(({r})=>!r.is_system&&r.mes?.trim());
    for(let i=1;i<visible.length;i++){
        if(tail.every((m,j)=>{const r=visible[i-1+j].r;return (r.is_user?'user':'assistant')===m.role && r.mes===m.content;}))hits.push(visible[i].index);
    }
    return hits.length===1?rowKeys(chat.rows.slice(0,hits[0]+1)):null;
}
export function parseInitiation(content) {
    const raw=String(content||'').trim();let result;
    try {result=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{
        if(raw.startsWith('{')||raw.startsWith('```'))throw new Error('Invalid model notification format.');
        result={text:raw};
    }
    if(typeof result.text!=='string'||result.text.trim().length<2||result.text.length>3500||/<think>|<analysis>/i.test(result.text))throw new Error('Invalid model notification text.');
    return {text:result.text.trim(),imagePrompt:typeof result.imagePrompt==='string'?result.imagePrompt.trim().slice(0,1500):null};
}
export function validateSnapshot(payload, chat) {
    if(payload.signature!==chat.signature || payload.chatHash!==chat.hash) throw new Error('Chat changed during context preparation. Refresh context after the reply has finished.');
    if(!Array.isArray(payload.params?.messages)||payload.params.messages.length<2) throw new Error('SillyTavern did not provide a complete prompt.');
    if(payload.params.chat_completion_source!=='custom') throw new Error('This first release supports the existing Venice custom connection.');
    const url=new URL(payload.params.custom_url);
    if(url.protocol!=='https:' || url.hostname!=='api.venice.ai' || url.username || url.password) throw new Error('The configured connection must be api.venice.ai.');
    const last=chat.rows.filter(m=>!m.is_system).at(-1);
    if(!last || last.is_user)throw new Error('Wait for the companion to finish replying before enabling initiation.');
    return true;
}
export function eligible(target, now) {
    if(!target.enabled || !target.snapshot || target.job || now<target.nextAt) return false;
    return target.test || !quietAt(now,target.quietStart,target.quietEnd);
}
export function initiationInstruction(name,user,now,lastReply,images=false) {
    return `[Proactive message from ${name} to ${user}. It is ${new Date(now).toLocaleString('en-GB',{timeZone:'Europe/London'})} in Europe/London. There is no new user turn. You may follow up without a reply; never invent a reply or action from the user, imply you observe their real surroundings, or pressure them to answer. Your last message was ${JSON.stringify(lastReply).slice(0,6000)}. Write a fresh natural thought, observation or question grounded in your character, world and conversation. About 1–3 sentences. Vary your topics instead of repeating the last message. ${images?'You may optionally share ONE still self-portrait if it naturally fits. Describe the scene, clothing and expression in imagePrompt; your own saved face reference is attached automatically. Do not assume the image succeeded or claim it has been sent in your text.':'No image is available; set imagePrompt to null.'} Videos are not available. Do not call tools. Return only a JSON object with text (your message) and imagePrompt (an optional visual description or null).]`;
}
