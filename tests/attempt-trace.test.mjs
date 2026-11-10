import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAttemptTrace, formatAttemptTrace, traceInitiationFetch, MINUTE, DEADLINE, stageNormal } from '../index.js';
import { fixture } from './helpers.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(fn) { for (let i = 0; i < 100 && !fn(); i++) await turn(); assert.ok(fn()); }

test('attempt trace is bounded, redacted, persistent, and records no request body', () => {
    let saved, changed = 0;
    const trace = createAttemptTrace({ read: () => null, write: value => { saved = structuredClone(value); }, changed: () => changed++ });
    for (let i = 0; i < 100; i++) trace.append({ timestamp: i, chat: 'A', attemptId: 'one', retry: 2, event: 'failed',
        detail: 'Authorization: Bearer SECRET', body: 'PRIVATE CHAT', type: 'question' });
    assert.equal(changed, 100); assert.equal(saved.length, 80); assert.equal(saved[0].timestamp, 20);
    assert.doesNotMatch(JSON.stringify(saved), /SECRET|PRIVATE CHAT/);
    const restored = createAttemptTrace({ read: () => saved, write() {} });
    assert.deepEqual(restored.rows(), saved);
    assert.match(formatAttemptTrace(saved.at(-1)), /retry 2/);
    assert.match(formatAttemptTrace(saved.at(-1)), /1970-01-01T00:00:00.099Z/);
});

test('diagnostic storage and UI errors cannot stop attempts', async () => {
    const trace = createAttemptTrace({ read: () => { throw Error('unavailable'); }, write() { throw Error('full'); }, changed() { throw Error('UI'); } });
    trace.append({ timestamp: 0, event: 'start', retry: 0 });
    assert.equal(trace.rows().length, 1);
    const f = fixture({ trace() { throw Error('observer failed'); } });
    await f.engine.tick(true); assert.equal(f.deliveries.length, 1);
});

test('HTTP 200 provider error is surfaced without changing the original response or request', async () => {
    const rows = [], body = { error: { message: 'Invalid request parameters', token: 'SECRET' } };
    const response = new Response(JSON.stringify(body), { status: 200 });
    const options = { method: 'POST', body: 'PRIVATE REQUEST', signal: new AbortController().signal };
    const wrapper = traceInitiationFetch(async (input, opts) => { assert.equal(opts, options); return response; }, (...args) => rows.push(args));
    assert.equal(await wrapper('/api/backends/chat-completions/generate', options), response);
    assert.deepEqual(await response.json(), body);
    await until(() => rows.some(r => r[0] === 'provider-error'));
    assert.match(rows.find(r => r[0] === 'provider-error')[1], /Invalid request parameters/);
    assert.doesNotMatch(JSON.stringify(rows), /SECRET|PRIVATE REQUEST/);
});

test('HTTP failures and rejected fetches retain exact error text and are never retried by logging', async () => {
    const rows = []; let calls = 0;
    const wrapper = traceInitiationFetch(async () => { calls++; return new Response('Bad payload', { status: 422 }); }, (...x) => rows.push(x));
    const response = await wrapper('/api/backends/chat-completions/generate', { method: 'POST' });
    assert.equal(await response.text(), 'Bad payload');
    await until(() => rows.some(r => r[0] === 'http-error'));
    assert.equal(calls, 1); assert.equal(rows.find(r => r[0] === 'http-error')[1], 'Bad payload');
    const error = new TypeError('Failed to fetch');
    await assert.rejects(traceInitiationFetch(async () => { throw error; }, (...x) => rows.push(x))('/api/backends/chat-completions/generate', { method: 'POST' }), e => e === error);
    assert.match(rows.find(r => r[0] === 'request-error')[1], /TypeError.*Failed to fetch/);
});

test('successful output is not logged and unrelated requests are untouched', async () => {
    const rows = [];
    const response = new Response(JSON.stringify({ choices: [{ message: { content: 'PRIVATE OUTPUT' } }] }));
    const wrapper = traceInitiationFetch(async () => response, (...x) => rows.push(x));
    await wrapper('/api/backends/chat-completions/generate', { method: 'POST' });
    await until(() => rows.some(r => r[0] === 'response-body-read'));
    assert.doesNotMatch(JSON.stringify(rows), /PRIVATE OUTPUT/);
    const before = rows.length;
    assert.equal(await wrapper('/api/settings/get', { method: 'POST' }), response);
    assert.equal(rows.length, before);
});

test('diagnostic response copy is bounded and does not consume a large original body', async () => {
    const rows = [], text = 'X'.repeat(100000);
    const response = new Response(text);
    await traceInitiationFetch(async () => response, (...x) => rows.push(x))('/api/backends/chat-completions/generate', { method: 'POST' });
    assert.equal((await response.text()).length, text.length);
    await until(() => rows.some(r => r[0] === 'response-detail-unavailable'));
    assert.ok(JSON.stringify(rows).length < 1000);
});

test('trace exposes uncapped backoff even with a 240 minute interval, without changing it', async () => {
    const rows = [], f = fixture({ trace: row => rows.push(row), deliver: async () => { throw Error('fixture failure'); } });
    const config = { ...f.db.config, min: 240, max: 240, creditUsd: 0 };
    await f.engine.updateConfig(config);
    const delays = [1, 2, 4, 8, 16, 30, 30, 30];
    for (let i = 0; i < delays.length; i++) {
        await f.engine.tick(i === 0);
        assert.equal(f.state().failureCount, i + 1);
        assert.equal(rows.filter(r => r.event === 'start').at(-1).retry, i);
        assert.match(rows.filter(r => r.event === 'failed').at(-1).detail, /fixture failure/);
        assert.equal(f.state().retryAt - f.d.now(), delays[i] * MINUTE);
        f.advance(delays[i] * MINUTE);
    }
    assert.equal(rows.filter(r => r.event === 'start').length, 8);
    assert.equal(f.timers.size, 0);
});

test('150 second timeout is visible and retains cancellation, cleanup, and backoff', async () => {
    const rows = [], f = fixture({ trace: row => rows.push(row), deliver: () => new Promise(() => {}) });
    const run = f.engine.tick(true);
    await until(() => f.engine.running);
    f.advance(DEADLINE); f.fireTimers(); await run;
    assert.ok(rows.some(r => r.event === 'cancel' && /150 seconds/.test(r.detail)));
    assert.ok(rows.some(r => r.event === 'failed' && /150 seconds/.test(r.detail)));
    assert.equal(f.engine.running, null); assert.equal(f.timers.size, 0);
});

test('adapter instrumentation restores fetch and settings after an assembly failure', async () => {
    const original = globalThis.fetch, settings = { stream_openai: true }, rows = [];
    const listeners = new Map();
    const host = { event_types: {}, eventSource: { makeLast(k, f) { listeners.set(k, f); }, removeListener(k) { listeners.delete(k); } },
        Generate: async () => { assert.notEqual(globalThis.fetch, original); throw Error('assembly failed'); } };
    await assert.rejects(stageNormal({ host, tools: {}, c: { mainApi: 'openai', chatCompletionSettings: settings },
        attempt: { guard() {} }, instruction: 'fixture', onTrace: (...x) => rows.push(x) }), /assembly failed/);
    assert.equal(globalThis.fetch, original); assert.equal(settings.stream_openai, true);
    assert.ok(rows.some(r => r[0] === 'generation-called'));
});

test('chat diagnostics render with textContent and do not post, save, emit events, or mutate chat', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const render = source.slice(source.indexOf('    function renderTrace()'), source.indexOf('    function selectTarget()'));
    assert.match(render, /line.textContent = formatAttemptTrace/);
    assert.match(render, /slice\(-20\)/);
    assert.doesNotMatch(render, /innerHTML|fetch\(|saveChat|eventSource|\.chat\.push/);
    assert.doesNotMatch(source, /location\s*\.\s*(reload|assign|replace)\s*\(/);
});
