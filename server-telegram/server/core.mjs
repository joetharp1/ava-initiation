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
        const b=norm(p); if(a===b || (a.length>35 && (b.includes(a)||a.includes(b)))) return true;
        const words=s=>new Set(s.split(' ').map((w,i,arr)=>arr.slice(i,i+3).join(' ')));
        const x=words(a),y=words(b),overlap=[...x].filter(w=>y.has(w)).length;
        return a.length>60 && overlap / Math.max(1,Math.min(x.size,y.size)) > .8;
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
export function sourceFingerprint(root, avatar) {
    const s=JSON.parse(fs.readFileSync(path.join(root,'settings.json'),'utf8'));
    // A different selected chat is not a change to this companion's context.
    const relevant={oai:s.oai_settings,world:s.world_info_settings,power:s.power_user,extensions:s.extension_settings,username:s.username,user_avatar:s.user_avatar};
    const files=[];
    const walk=(dir,depth=0)=>{
        if(!fs.existsSync(dir)||depth>4)return;
        for(const d of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
            const p=path.join(dir,d.name);if(d.isDirectory())walk(p,depth+1);else {const st=fs.statSync(p);files.push([p,st.size,st.mtimeMs]);}
        }
    };
    for(const sub of ['worlds','user/files'])walk(path.join(root,sub));
    const card=path.join(root,'characters',safeName(avatar));
    const cardData=fs.readFileSync(card);
    return hash([relevant,files,hash(cardData)]);
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
    if(!target.enabled || !target.snapshot || target.job || target.awaitingReply || now<target.nextAt) return false;
    if(!target.test && quietAt(now,target.quietStart,target.quietEnd))return false;
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date(now));
    return target.test || (target.day!==day || (target.dayCount||0)<3);
}
export function initiationInstruction(name, user, now, lastReply) {
    return `[New proactive message, not a response to a new user turn. It is ${new Date(now).toLocaleString('en-GB',{timeZone:'Europe/London'})} in Europe/London. The preceding exchange is already complete. The last reply you sent was: ${JSON.stringify(lastReply).slice(0,6000)}. Write one fresh, brief, natural message from ${name} to ${user}, grounded in your established character and the supplied conversation/memories. Choose a new thought, observation, or question rather than repeating or continuing your last reply. Do not invent a new message or action from ${user}, claim to observe their real surroundings, or pressure them to answer. Stay in character. Output only the message, with no planning, headings, JSON, or tool calls. Keep it suitable as a short text notification, about 1–3 sentences.]`;
}
