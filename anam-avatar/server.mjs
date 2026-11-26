import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const root = process.env.STATE_ROOT || '/state';
const origin = process.env.PUBLIC_ORIGIN;
if (!origin || !process.env.ST_USER || !process.env.ST_PASSWORD) throw Error('Authentication configuration missing');
const auth = Buffer.from('Basic ' + Buffer.from(`${process.env.ST_USER}:${process.env.ST_PASSWORD}`).toString('base64'));
fs.mkdirSync(root, {recursive:true, mode:0o700});
const file = path.join(root, 'anam.json');
let config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {apiKey:'', faces:{}};
const remote = process.env.NODE_ENV === 'test' ? process.env.TEST_ANAM_URL : 'https://api.anam.ai';
const MAX_SECONDS = 180;
let busy = false, lastToken = 0, lease = null;
class UserError extends Error {}
function fail(message) { throw new UserError(message); }
function save(next) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(next), {mode:0o600});
  fs.chmodSync(file + '.tmp', 0o600);
  fs.renameSync(file + '.tmp', file);
  config = next;
}
function character(value) {
  if (typeof value !== 'string' || !value.endsWith('.png') || /[/\\]/.test(value) || value.includes('..') || value.length > 250) fail('Open a single companion chat first.');
  return value;
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) fail('Enter the avatar ID from Anam’s Avatars page.');
  return value.toLowerCase();
}
async function api(route, method='GET', body, key=config.apiKey) {
  if (!key) fail('Save your Anam API key first.');
  const r = await fetch(remote + route, {method, headers:{Authorization:'Bearer ' + key, 'Content-Type':'application/json'}, body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(20000)});
  if (!r.ok) fail(`Anam returned HTTP ${r.status}. Check the key, avatar ID, permissions and account allowance.`);
  return r.json();
}
async function face(id, key) {
  id = uuid(id);
  const r = await api('/v1/avatars/' + id, 'GET', undefined, key);
  if (r.id !== id) fail('Anam returned an unexpected avatar response.');
  return {id, name:typeof r.displayName === 'string' ? r.displayName : id, model:typeof r.activeVersion === 'string' ? r.activeVersion : null};
}
async function dispatch(route, b) {
  if (route === '/status') return {configured:!!config.apiKey, faces:config.faces, suggestedAstraId:process.env.ASTRA_AVATAR_ID || '', maxSeconds:MAX_SECONDS};
  if (route === '/setup' || route === '/assign') {
    const avatar = character(b.avatar);
    let key = config.apiKey;
    if (route === '/setup') {
      if (typeof b.apiKey !== 'string' || b.apiKey.trim().length < 10 || b.apiKey.length > 4096 || /[\r\n]/.test(b.apiKey)) fail('Enter your Anam API key in the private key field.');
      key = b.apiKey.trim();
    }
    const selected = await face(b.faceId, key);
    save({...config, apiKey:key, faces:{...config.faces, [avatar]:selected}});
    return {configured:true, face:selected};
  }
  if (route === '/release') {
    if (lease && b.leaseId === lease.id) lease = null;
    return {ok:true};
  }
  if (route === '/token') {
    const selected = config.faces[character(b.avatar)];
    if (!selected) fail('Assign an Anam avatar to this companion first.');
    if (busy || (lease && lease.until > Date.now())) fail('An Anam preview is already active. Stop it first, or wait three minutes.');
    if (Date.now() - lastToken < 10000) fail('Please wait ten seconds before starting another preview.');
    busy = true; lastToken = Date.now();
    try {
      const personaConfig = {avatarId:selected.id, enableAudioPassthrough:true, maxSessionLengthSeconds:MAX_SECONDS};
      if (selected.model) personaConfig.avatarModel = selected.model;
      const r = await api('/v1/auth/session-token', 'POST', {personaConfig, sessionOptions:{dataRetention:{recording:false, transcripts:false}}});
      if (typeof r.sessionToken !== 'string') fail('Anam did not return a session token.');
      lease = {id:crypto.randomUUID(), until:Date.now() + (MAX_SECONDS + 45) * 1000};
      return {sessionToken:r.sessionToken, leaseId:lease.id, maxSeconds:MAX_SECONDS};
    } finally { busy = false; }
  }
  fail('Unknown endpoint.');
}
const server = http.createServer(async(req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const incoming = Buffer.from(req.headers.authorization || '');
  if (incoming.length !== auth.length || !crypto.timingSafeEqual(incoming, auth)) {
    res.writeHead(401, {'WWW-Authenticate':'Basic realm="SillyTavern"'}); res.end(); return;
  }
  if (req.method !== 'POST' || req.headers['x-astra-anam'] !== '1' || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403); res.end(); return; }
  try {
    const pathname = new URL(req.url, origin).pathname;
    if (!pathname.startsWith('/astra-anam/')) { res.writeHead(404); res.end(); return; }
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 12000) fail('Request too large.'); chunks.push(c); }
    const b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!b || Array.isArray(b) || typeof b !== 'object') fail('Invalid request.');
    const data = await dispatch(pathname.slice('/astra-anam'.length), b);
    res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(400, {'Content-Type':'application/json'});
    res.end(JSON.stringify({error:e instanceof UserError ? e.message : 'Anam request failed. Please retry.'}));
  }
});
server.requestTimeout = 30000;
server.listen(Number(process.env.PORT) || 8789, '0.0.0.0', () => console.log('Anam bridge ready; configured: ' + !!config.apiKey));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
