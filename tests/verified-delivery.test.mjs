import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repeatsOpening, deliverOpening, readSavedChat, assertSavedDelivery, assertCurrentHistory, MINUTE } from '../index.js';
import { fixture } from './helpers.mjs';

for (const [a, b] of [
    ['“Come here.”', 'come here'],
    ['I’m still waiting for you to come and sit with me.', "I'm still waiting for you to come and sit with me"],
    ['Come and sit beside me, I have something to tell you.', 'Come and sit next to me, I have something to tell you.'],
]) test(`repeat detection: ${a}`, () => assert.equal(repeatsOpening(a, b), true));

test('distinct short and long openings are allowed', () => {
    assert.equal(repeatsOpening('Come here.', 'Come outside.'), false);
    assert.equal(repeatsOpening('I have a question about what we should cook tonight.', 'I wanted to ask if you have heard this song before.'), false);
});

test('repeat gets one retry, only the fresh line publishes; recent older messages are included', async () => {
    const chat = [{ mes: 'Come here.' }, { is_user: true, mes: 'Why?' }, { mes: 'Tell me something.' }];
    let generations = 0, repeats = 0; const published = [];
    await deliverOpening({ attempt: { c: { chat }, history: '[]', type: 'question', guard() {}, onRepeat: () => repeats++ },
        generate: async () => ++generations === 1 ? '“Come here.”' : 'Shall we put some music on?',
        publishText: async text => published.push(text), publishPhoto: () => assert.fail() });
    assert.equal(generations, 2); assert.equal(repeats, 1); assert.deepEqual(published, ['Shall we put some music on?']);
});

test('two repeats produce neither a chat message nor notification or photo charge', async () => {
    let generations = 0, notices = 0;
    const f = fixture({ notify: () => notices++, deliver: attempt => deliverOpening({ attempt,
        generate: async () => { generations++; return '“Come here.”'; }, publishText: () => assert.fail(), publishPhoto: () => assert.fail() }) });
    f.c.chat.push({ mes: 'Come here.' }); await f.engine.tick(true);
    assert.equal(generations, 2); assert.equal(notices, 0); assert.equal(f.c.chat.length, 1);
    assert.equal(f.db.log.filter(r => r.outcome === 'repeat-rejected').length, 2);
    assert.equal(f.db.log.filter(r => r.outcome === 'sent').length, 0);
    assert.equal(f.db.budget, null);
});

const line = { mes: 'A fresh opening.', extra: { ava_initiation: { attemptId: 'a' } } };
test('readback addresses the captured avatar and chat, ignores header and bypasses cache', async () => {
    let request;
    const saved = await readSavedChat({ avatar: 'Ava.png', chatId: 'morning', name2: 'Ava' }, { headers: { 'x-csrf-token': 'test' }, fetcher: async (url, options) => {
        request = { url, ...options }; return { ok: true, json: async () => [{ chat_metadata: {} }, line] };
    } });
    assert.equal(request.url, '/api/chats/get'); assert.equal(request.cache, 'no-store');
    assert.deepEqual(JSON.parse(request.body), { ch_name: 'Ava', avatar_url: 'Ava.png', file_name: 'morning' });
    assert.deepEqual(saved, [line]); assertSavedDelivery(saved, line);
});

test('readback rejects missing ID, mismatched text and missing image', () => {
    assert.throws(() => assertSavedDelivery([{ ...line, extra: {} }], line), /not confirmed/);
    assert.throws(() => assertSavedDelivery([{ ...line, mes: 'Old message.' }], line), /not confirmed/);
    assert.throws(() => assertSavedDelivery([line], { ...line, extra: { ...line.extra, media: [{ url: '/photo.png' }] } }), /not confirmed/);
});

test('readback rejects HTTP and invalid-body failures', async () => {
    await assert.rejects(readSavedChat({}, { fetcher: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
    await assert.rejects(readSavedChat({}, { fetcher: async () => ({ ok: true, json: async () => ({}) }) }), /invalid response/);
});

test('stale history fails closed, but irrelevant metadata changes do not', () => {
    assert.throws(() => assertCurrentHistory([{ mes: 'New server reply.' }], [{ mes: 'Old cached reply.' }]), /different chat history/);
    assertCurrentHistory([line], [{ ...line, gen_finished: 123, extra: { ...line.extra, token_count: 30 } }]);
});

test('silent save failure holds the attempt without notifying or generating again; later readback recovers once', async () => {
    let persisted = false, notifications = 0, requests = 0;
    const f = fixture({ verifyDelivery: async (c, message) => assertSavedDelivery(persisted ? c.chat : [], message),
        notify: () => notifications++, deliver: async a => {
            requests++;
            const message = { mes: 'Here is a new opening.', extra: { ava_initiation: { attemptId: a.id } } };
            a.c.chat.push(message); await a.onPublished(a.c.chat.length - 1, message);
        } });
    await f.engine.tick(true);
    assert.equal(notifications, 0); assert.equal(f.db.log.filter(r => r.outcome === 'sent').length, 0);
    assert.equal(f.state().attempt.verificationPending, true);
    await f.engine.tick(true); assert.equal(requests, 1);
    f.advance(MINUTE); await f.engine.tick(); assert.equal(requests, 1); assert.equal(notifications, 0);
    persisted = true; f.advance(MINUTE); await f.engine.tick();
    assert.equal(notifications, 1); assert.equal(requests, 1); assert.equal(f.state().attempt, null);
    await f.engine.tick(); assert.equal(notifications, 1); assert.equal(f.c.chat.length, 1);
});

test('another selected chat blocks an old tab and fences an in-flight attempt', async () => {
    let current = false;
    const f = fixture({ targetCurrent: () => current });
    await f.engine.tick(true); assert.equal(f.deliveries.length, 0);
    assert.match(f.notices.at(-1), /another chat/);
    current = true;
    f.d.deliver = async a => { current = false; a.guard(); };
    await f.engine.tick(true); assert.equal(f.c.chat.length, 0); assert.equal(f.db.log.filter(r => r.outcome === 'sent').length, 0);
});

test('verified ST source supplies readback shape and request headers; save methods can swallow errors', async t => {
    if (!process.env.ST_SCRIPT) return t.skip('Set ST_SCRIPT for source verification.');
    const source = await readFile(process.env.ST_SCRIPT, 'utf8');
    assert.match(source, /export function getRequestHeaders\(/);
    const save = source.slice(source.indexOf('export async function saveChat('), source.indexOf('export async function saveChat(') + 4200);
    assert.match(save, /catch \(error\)/); assert.match(save, /toastr.error/);
    const get = source.slice(source.indexOf('export async function getChat()'), source.indexOf('export async function getChat()') + 2200);
    assert.match(get, /file_name: characters\[this_chid\].chat/); assert.match(get, /data.shift\(\)/);
});

test('photo notification follows verified line and image; an unsaved photo is never logged as delivered', async () => {
    for (const saveImage of [true, false]) {
        let saved = [], notifications = 0; const order = [];
        const f = fixture({
            verifyDelivery: async (c, message) => { order.push(message.mes ? 'verify-line' : 'verify-image'); assertSavedDelivery(saved, message); },
            notify: () => { order.push('notify'); notifications++; },
            deliver: attempt => deliverOpening({ attempt,
                generate: async instruction => instruction.startsWith('Write a scene') ? 'By the window.' : 'Come and keep me company.',
                publishText: async text => {
                    const m = { mes: text, extra: { ava_initiation: { attemptId: attempt.id } } };
                    attempt.c.chat.push(m); saved = structuredClone(attempt.c.chat); order.push('save-line');
                    await attempt.onPublished(0, m);
                },
                publishPhoto: async () => {
                    attempt.reservePhoto(.06);
                    const m = { mes: '', extra: { ava_initiation: { attemptId: attempt.id }, media: [{ url: '/new-photo.png' }] } };
                    attempt.c.chat.push(m); if (saveImage) saved = structuredClone(attempt.c.chat);
                    order.push('save-image'); await attempt.onPublished(1, m);
                },
            }),
        });
        await f.engine.tick(true);
        assert.equal(notifications, 1);
        assert.deepEqual(order, ['save-line', 'verify-line', 'save-image', 'verify-image', 'notify']);
        const sent = f.db.log.find(r => r.outcome === 'sent');
        assert.equal(sent.image, saveImage ? '/new-photo.png' : null);
        if (!saveImage) assert.ok(f.db.log.some(r => r.outcome === 'failed' && r.partialDelivery));
    }
});
