import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleDiagnostic, DEADLINE, stageNormal } from '../index.js';
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(extra = {}, storage = {}) {
    let now = 1000, active = { avatar: 'A', chatId: 'chat-a', chat: [] }, id = 0;
    const rows = [], statuses = [], timers = new Map(), calls = { run: 0, lock: 0 };
    const d = { active: () => active, blocked: () => '', now: () => now, uuid: () => `id-${++id}`,
        readUsed: () => storage.used, writeUsed: value => { storage.used = value; },
        locks: { request: async (_name, opts, fn) => { calls.lock++; return fn({}); } }, lockName: 'profile',
        setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimer: key => timers.delete(key),
        trace: row => rows.push(row), status: text => statuses.push(text),
        execute: async job => { calls.run++; job.guard(); return 'A new opening'; }, ...extra };
    return { d, single: createSingleDiagnostic(d), calls, rows, statuses, timers, storage,
        advance: ms => { now += ms; }, switchChat: () => { active = { ...active, chatId: 'b', chat: [] }; } };
}

test('construction and elapsed time do not start a test; success reserves one run across reload', async () => {
    const f = fixture(); f.advance(24 * 60 * 60 * 1000);
    assert.equal(f.calls.run, 0); assert.equal(f.timers.size, 0); assert.equal(f.calls.lock, 0);
    await f.single.run(); assert.equal(f.calls.run, 1); assert.equal(f.timers.size, 0);
    assert.equal(f.single.used, true); assert.ok(f.rows.some(r => r.event === 'single-success'));
    await f.single.run();
    const reloaded = fixture({}, f.storage); await reloaded.single.run();
    assert.equal(f.calls.run, 1); assert.equal(reloaded.calls.run, 0);
    assert.equal(f.d.active().chat.length, 0);
});

test('Failed to fetch never retries; copyable error records include ID and retry zero', async () => {
    let calls = 0;
    const f = fixture({ execute: async () => { calls++; throw new TypeError('Failed to fetch'); } });
    await f.single.run(); f.advance(30 * 60 * 1000); await f.single.run();
    assert.equal(calls, 1); assert.equal(f.timers.size, 0);
    const row = f.rows.find(r => r.event === 'single-failed');
    assert.equal(row.retry, 0); assert.equal(row.attemptId, f.storage.used.id);
    assert.match(row.detail, /TypeError.*Failed to fetch/);
});

test('double click, timeout, and late resolution cannot run or publish a second attempt', async () => {
    let resolve, cancel = 0, calls = 0;
    const f = fixture({ execute: job => { calls++; job.onCancelReady(() => cancel++); return new Promise(r => { resolve = r; }); } });
    const work = f.single.run(); await turn(); await f.single.run();
    assert.equal(calls, 1); assert.equal(f.single.busy, true);
    f.advance(DEADLINE); [...f.timers.values()][0].fn(); await work;
    resolve('late text'); await turn();
    assert.equal(cancel, 1); assert.equal(f.timers.size, 0);
    assert.ok(f.rows.some(r => r.event === 'single-failed' && /150 seconds/.test(r.detail)));
    assert.equal(f.rows.some(r => r.event === 'single-success'), false);
    await f.single.run(); assert.equal(calls, 1);
});

test('manual cancel prevents a delayed chat read from starting generation', async () => {
    let resolveRead, generations = 0;
    const f = fixture({ execute: async job => { await new Promise(r => { resolveRead = r; }); job.guard(); generations++; return 'text'; } });
    const work = f.single.run(); await turn(); f.single.cancel('Stopped by Joe.'); await work;
    resolveRead(); await turn(); assert.equal(generations, 0);
    assert.ok(f.rows.some(r => r.event === 'cancel' && r.detail === 'Stopped by Joe.'));
});

test('chat change rejects late success and keeps the trace assigned to the original chat', async () => {
    let resolve;
    const f = fixture({ execute: () => new Promise(r => { resolve = r; }) });
    const work = f.single.run(); await turn(); f.switchChat(); resolve('late'); await work;
    assert.ok(f.rows.every(r => r.chat === '["A","chat-a"]'));
    assert.ok(f.rows.some(r => r.event === 'single-failed')); assert.equal(f.timers.size, 0);
});

test('busy lock or composer starts no work and consumes no reservation', async () => {
    const blocked = fixture({ blocked: () => 'Composer busy' }); await blocked.single.run();
    assert.equal(blocked.calls.run, 0); assert.equal(blocked.single.used, false);
    const locked = fixture({ locks: { request: async (_name, _opts, fn) => fn(null) } }); await locked.single.run();
    assert.equal(locked.calls.run, 0); assert.equal(locked.single.used, false);
});

test('failed reservation storage blocks generation, and a reservation from another tab is honored inside lock', async () => {
    const full = fixture({ writeUsed: () => { throw Error('Storage full'); } }); await full.single.run();
    assert.equal(full.calls.run, 0); assert.ok(full.rows.some(r => r.event === 'single-blocked'));
    const shared = {}, f = fixture({ locks: { request: async (_name, _opts, fn) => { shared.used = { id: 'other-tab' }; return fn({}); } } }, shared);
    await f.single.run(); assert.equal(f.calls.run, 0);
});

test('real generation adapter blocks a second model request before fetch dispatch', async () => {
    const original = globalThis.fetch, previousDocument = globalThis.document;
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response('{"choices":[{"message":{"content":"ok"}}]}'); };
    globalThis.document = { getElementById: () => ({ value: '' }) };
    const listeners = new Map();
    const events = { makeLast: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
        removeListener: (name, fn) => listeners.set(name, (listeners.get(name) || []).filter(x => x !== fn)) };
    const settings = { stream_openai: true };
    const host = { eventSource: events, event_types: {}, Generate: async () => {
        const opts = { method: 'POST', body: '{"messages":[]}' };
        await fetch('/api/backends/chat-completions/generate', opts);
        await fetch('/api/backends/chat-completions/generate', opts);
        return '{"text":"not reached"}';
    } };
    try {
        await assert.rejects(stageNormal({ host, tools: {}, c: { mainApi: 'openai', chatCompletionSettings: settings },
            attempt: { guard() {} }, instruction: 'one test', onDiagnostic() {} }), /one outgoing request/);
        assert.equal(requests, 1); assert.equal(settings.stream_openai, true);
    } finally { globalThis.fetch = original; globalThis.document = previousDocument; }
});
