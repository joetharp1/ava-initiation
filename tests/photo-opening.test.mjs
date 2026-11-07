import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverOpening, stageNormal, historyWithinTokens, failureText, retryFailedFetch, createEngine, chatKey } from '../index.js';
import { fixture } from './helpers.mjs';

function photoFixture(failAt) {
    const order = [], notifications = [];
    const f = fixture({ notify: async (_, message) => notifications.push(message.mes), deliver: async attempt => {
        let generations = 0;
        await deliverOpening({ attempt,
            generate: async instruction => {
                order.push(++generations === 1 ? 'line-generation' : 'scene-generation');
                if (generations === 1) {
                    assert.match(instruction, /one short sentence/);
                    return 'Come and keep me company.';
                }
                assert.equal(f.c.chat[0].mes, 'Come and keep me company.', 'line already delivered before scene request');
                if (failAt === 'scene') throw { error: { message: 'Bad scene request', code: 400 } };
                return 'Seated by the window in a cream jumper.';
            },
            publishText: async text => {
                order.push('line-save');
                const message = { mes: text, extra: { ava_initiation: { attemptId: attempt.id } } };
                f.c.chat.push(message); attempt.onPublished(0, message);
            },
            publishPhoto: async scene => {
                order.push('image-request'); assert.match(scene, /cream jumper/);
                attempt.reservePhoto(.06);
                if (failAt === 'image') throw new Error('Venice HTTP 400: invalid image parameters');
                const message = { mes: '', extra: { ava_initiation: { attemptId: attempt.id }, media: [{ url: '/photo.png' }] } };
                f.c.chat.push(message); attempt.onPublished(1, message); order.push('image-save');
            },
        });
    } });
    return { f, order, notifications };
}

test('photo sends line before scene/image, records both with one unread and one notification', async () => {
    const { f, order, notifications } = photoFixture();
    await f.engine.tick(true);
    assert.deepEqual(order, ['line-generation', 'line-save', 'scene-generation', 'image-request', 'image-save']);
    assert.equal(f.c.chat.length, 2); assert.equal(f.state().unread, 1);
    assert.deepEqual(notifications, ['Come and keep me company.']);
    const sent = f.db.log.filter(r => r.outcome === 'sent');
    assert.equal(sent.length, 1); assert.equal(sent[0].image, '/photo.png'); assert.equal(sent[0].imageMessageId, 1);
    assert.equal(f.db.budget.attempts, 1);
});

for (const stage of ['scene', 'image']) test(`${stage} failure keeps the line, logs raw reason, and never repeats it on ticks`, async () => {
    const { f, notifications } = photoFixture(stage);
    await f.engine.tick(true);
    assert.equal(f.c.chat.length, 1); assert.equal(f.state().unread, 1);
    assert.equal(f.state().pending, null);
    const failure = f.db.log.find(r => r.outcome === 'failed');
    assert.equal(failure.type, 'photo'); assert.equal(failure.partialDelivery, true);
    assert.match(failure.text, stage === 'scene' ? /Bad scene request/ : /invalid image parameters/);
    assert.match(f.notices.at(-1), /Line delivered; photo failed:/);
    assert.equal(f.db.budget?.attempts ?? 0, stage === 'scene' ? 0 : 1);
    assert.equal(notifications.length, 1);
    f.advance(10000); await f.engine.tick(); assert.equal(f.c.chat.length, 1);
});

test('generation failure before the line logs structured raw error', async () => {
    const f = fixture({ deliver: async () => { throw { error: { message: 'Provider refused request', parameter: 'temperature' } }; } });
    await f.engine.tick(true);
    assert.equal(f.c.chat.length, 0);
    assert.match(f.db.log.find(r => r.outcome === 'failed').text, /Provider refused request/);
    assert.match(f.db.log.find(r => r.outcome === 'failed').text, /temperature/);
});

test('history excludes the final assistant text and instruction quotes it verbatim', async () => {
    const last = 'I was just thinking about that.';
    const history = await historyWithinTokens([{ outcome: 'sent', text: 'Older opening' }, { outcome: 'sent', text: last }], async () => 20, 512, last);
    assert.equal(JSON.parse(history).length, 1);
    let instruction, published;
    await deliverOpening({ attempt: { c: { chat: [{ mes: last }] }, type: 'question', history, guard() {} },
        generate: async i => { instruction = i; return 'Fancy some music?'; }, publishText: async t => { published = t; },
        publishPhoto: () => assert.fail() });
    assert.ok(instruction.includes(`Do not repeat, continue or lightly reword your own last message. It was: '${last}'. Write something new.`));
    assert.equal(published, 'Fancy some music?');
});

test('exact repeated model output is rejected before publication', async () => {
    await assert.rejects(deliverOpening({ attempt: { c: { chat: [{ mes: 'Same old line.' }] }, guard() {} },
        generate: async () => 'Same old line.', publishText: () => assert.fail(), publishPhoto: () => assert.fail() }), /duplicate was not sent/);
});

test('last assistant turn is removed only from request; system context and saved chat remain intact', async () => {
    const handlers = new Map(), last = 'Her final message.';
    const source = { makeLast: (k, f) => handlers.set(k, [...(handlers.get(k) || []), f]), removeListener: (k, f) => handlers.set(k, handlers.get(k).filter(x => x !== f)) };
    const c = { mainApi: 'openai', chat: [{ mes: last }], chatCompletionSettings: { stream_openai: true } };
    const host = { eventSource: source, event_types: { GENERATION_AFTER_COMMANDS: 'entry', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'settings' },
        Generate: async () => {
            const event = { chat: [{ role: 'system', content: 'World Info' }, { role: 'user', content: 'Old exchange' }, { role: 'assistant', content: last }] };
            for (const fn of handlers.get('prompt')) await fn(event);
            assert.deepEqual(event.chat.map(m => m.role), ['system', 'user', 'system']);
            assert.equal(event.chat[0].content, 'World Info');
            assert.equal(c.chat[0].mes, last);
            return '{"text":"Something new."}';
        } };
    await stageNormal({ host, tools: {}, c, attempt: { guard() {} }, instruction: 'Fresh opening', excludedLastMessage: last });
    assert.ok([...handlers.values()].every(list => list.length === 0));
});

test('chat switch after delivered line prevents the subsequent image', async () => {
    let current = true;
    await assert.rejects(deliverOpening({ attempt: { c: { chat: [] }, type: 'photo', guard() { if (!current) throw new Error('chat changed'); } },
        generate: async () => 'A new line.', publishText: async () => { current = false; }, publishPhoto: () => assert.fail() }), /chat changed/);
});

test('failure detail preserves nested fields but redacts credentials', () => {
    const text = failureText({ error: { message: 'Bad request', token: 'secret-value' }, authorization: 'Bearer abc123' });
    assert.match(text, /Bad request/); assert.doesNotMatch(text, /secret-value|abc123/);
});

test('background photo is held without a request or reservation and resumes the same pending job', async () => {
    let hidden = true;
    const f = fixture({ hidden: () => hidden });
    await f.engine.tick(true);
    assert.equal(f.notices.at(-1), 'Held, app backgrounded');
    const pending = f.state().pending.id;
    assert.equal(f.state().pending.type, 'photo'); assert.equal(f.deliveries.length, 0); assert.equal(f.db.budget, null);
    await f.engine.tick(); assert.equal(f.state().pending.id, pending);
    hidden = false; await f.engine.tick();
    assert.equal(f.deliveries.length, 1); assert.equal(f.deliveries[0].type, 'photo');
});

test('text may run in the background', async () => {
    const f = fixture({ hidden: () => true, photoStatus: () => ({ ready: false }) });
    await f.engine.tick(true); assert.equal(f.deliveries.length, 1); assert.notEqual(f.deliveries[0].type, 'photo');
});

test('Failed to fetch retries once after delay, logs network and error name, releases empty failure budget', async () => {
    let requests = 0; const delays = [];
    const f = fixture({ wait: async ms => delays.push(ms), deliver: async attempt => attempt.retryNetwork(async () => {
        attempt.reservePhoto(.06); requests++;
        throw new TypeError('Failed to fetch');
    }) });
    await f.engine.tick(true);
    assert.equal(requests, 2); assert.deepEqual(delays, [1000]);
    assert.equal(f.db.budget.attempts, 0); assert.equal(f.db.budget.spent, 0);
    assert.deepEqual(f.db.budget.reservations, []);
    const retry = f.db.log.find(r => r.outcome === 'retry'), failure = f.db.log.find(r => r.outcome === 'failed');
    assert.equal(retry.tag, 'network'); assert.equal(failure.tag, 'network');
    assert.equal(failure.errorName, 'TypeError'); assert.match(failure.text, /Failed to fetch/);
});

test('successful network retry after a line does not repeat the line or notification', async () => {
    let requests = 0, notices = 0;
    const f = fixture({ wait: async () => {}, notify: async () => notices++, deliver: async attempt => {
        const line = { mes: 'Here I am.', extra: { ava_initiation: { attemptId: attempt.id } } };
        f.c.chat.push(line); attempt.onPublished(0, line);
        await attempt.retryNetwork(async () => {
            attempt.reservePhoto(.06);
            if (++requests === 1) throw new TypeError('Failed to fetch');
            const photo = { mes: '', extra: { ava_initiation: { attemptId: attempt.id }, media: [{ url: '/recovered.png' }] } };
            f.c.chat.push(photo); attempt.onPublished(1, photo);
        });
    } });
    await f.engine.tick(true);
    assert.equal(f.c.chat.length, 2); assert.equal(requests, 2); assert.equal(notices, 1);
    assert.equal(f.db.log.filter(r => r.outcome === 'failed').length, 0);
    assert.equal(f.db.budget.attempts, 2); assert.equal(f.db.budget.spent, 120000);
});

test('provider errors and other TypeErrors do not get network retries', async () => {
    for (const error of [new Error('HTTP 400: rejected'), new TypeError('Invalid argument')]) {
        let calls = 0;
        await assert.rejects(retryFailedFetch(async () => { calls++; throw error; }, { wait: () => assert.fail() }));
        assert.equal(calls, 1);
    }
});

test('network retry checks cancellation and shares one retry allowance across stages', async () => {
    const state = { used: false }; let calls = 0;
    await retryFailedFetch(async () => { if (++calls === 1) throw new TypeError('Failed to fetch'); return 'ok'; }, { state, wait: async () => {} });
    await assert.rejects(retryFailedFetch(async () => { throw new TypeError('Failed to fetch'); }, { state, wait: () => assert.fail() }));
    await assert.rejects(retryFailedFetch(async () => { throw new TypeError('Failed to fetch'); }, {
        wait: async () => {}, guard: () => { throw new Error('Chat changed'); },
    }), /Chat changed/);
});

test('reload releases an expired undelivered reservation once, preserving unrelated spend', async () => {
    const f = fixture(); await f.engine.activate();
    const db = f.db;
    db.chats[chatKey(f.c)].attempt = { id: 'lost', type: 'photo', deadline: f.d.now() - 1, delivered: false };
    db.budget = { start: f.d.now() - 1000, end: f.d.now() + 60000, attempts: 2, spent: 120000, reservations: ['unrelated', 'lost'] };
    db.log.push({ chat: chatKey(f.c), outcome: 'photo-reserved', attemptId: 'lost', costMicros: 60000 });
    const restarted = createEngine(f.d); await restarted.tick();
    assert.equal(f.db.budget.attempts, 1); assert.equal(f.db.budget.spent, 60000);
    assert.deepEqual(f.db.budget.reservations, ['unrelated']);
    await restarted.tick(); assert.equal(f.db.budget.attempts, 1);
});

test('network retry does not bypass the credit cap', async () => {
    let requests = 0;
    const f = fixture({ wait: async () => {}, deliver: async attempt => attempt.retryNetwork(async () => {
        attempt.reservePhoto(.06); requests++; throw new TypeError('Failed to fetch');
    }) });
    f.db.config.creditUsd = .06;
    await f.engine.tick(true);
    assert.equal(requests, 1); assert.equal(f.db.budget.spent, 0);
    assert.match(f.db.log.find(r => r.outcome === 'failed').text, /credit cap/);
});
