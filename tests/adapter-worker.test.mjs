import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stageNormal, createWakeLoop, installWorker, waitForNotificationWorker, observeServiceWorkerReady } from '../index.js';
function events() {
    const handlers = new Map(); return { makeLast: (name, fn) => handlers.set(name, [...(handlers.get(name) || []).filter(x => x !== fn), fn]),
        removeListener: (name, fn) => handlers.set(name, handlers.get(name).filter(x => x !== fn)),
        async emit(name, ...args) { for (const fn of handlers.get(name) || []) await fn(...args); }, handlers };
}
test('normal Generate preserves World Info and state injection while blocking tool calls', async () => {
    globalThis.document = { getElementById: () => ({ value: '' }) };
    let injected = 0;
    const e = events(), scope = { retrieve: () => { injected++; } };
    const originalRetrieve = scope.retrieve;
    const tools = { canPerformToolCalls: () => true, registerFunctionToolsOpenAI: () => {}, invokeFunctionTools: () => {} };
    const before = { ...tools }, config = { stream_openai: true, function_calling: true, prompts: [] };
    const c = { mainApi: 'openai', chatCompletionSettings: config, getCharacterCardFields: () => assert.fail('Do not reconstruct or duplicate the character description'), substituteParams: s => s,
        chat: [{ is_user: true, mes: 'Hi' }] };
    let count = 0;
    const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'commands', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'request' }, isGenerating: () => false,
        Generate: async (type, options) => {
            count++; assert.equal(type, 'normal'); assert.equal(options.automatic_trigger, true); assert.equal(options.jsonSchema.returnInvalid, true); assert.equal(Object.hasOwn(options, 'skipWIAN'), false);
            assert.equal(config.function_calling, true); assert.equal(config.stream_openai, false); assert.equal(tools.canPerformToolCalls(), false);
            await e.emit('commands', type, options, false); await scope.retrieve();
            const original = [{ role: 'system', content: 'Character description: appearance goes here once' }, { role: 'system', content: 'WORLD INFO — STATE TRACKER: current relationship state' }, { role: 'assistant', content: 'Previous exchange' }];
            const event = { chat: [...original] }; await e.emit('prompt', event);
            assert.deepEqual(event.chat.slice(0, original.length), original);
            assert.equal(event.chat.at(-1).content, 'Initiate');
            const preset = { top_k: 37, repetition_penalty: 1.12, vendor_option: { keep: true }, venice_parameters: {
                include_venice_system_prompt: true, enable_web_search: 'auto', enable_web_scraping: true, custom_nested_flag: 'keep-me' } };
            const request = { messages: event.chat, stream: true, tools: ['memory'], tool_choice: 'auto',
                custom_include_body: JSON.stringify(preset), custom_exclude_body: 'frequency_penalty' };
            await e.emit('request', request); assert.equal(request.tools, undefined); assert.equal(request.stream, false);
            assert.equal(request.messages, event.chat);
            assert.equal(request.messages.filter(m => m.content.includes('Character description:')).length, 1);
            assert.ok(request.messages.some(m => m.content.includes('STATE TRACKER')));
            assert.deepEqual(JSON.parse(request.custom_include_body), { ...preset, venice_parameters: {
                ...preset.venice_parameters, include_venice_system_prompt: false, enable_web_search: 'off', enable_web_scraping: false } });
            assert.equal(request.custom_exclude_body, 'frequency_penalty');
            await assert.rejects(tools.invokeFunctionTools(), /disabled/);
            return '{"text":"Hello there"}';
        } };
    const result = await stageNormal({ host, ext: { extensionNames: ['vectors'], getExtensionManifest: () => ({ generate_interceptor: 'retrieve' }) }, tools, c,
        attempt: { guard() {}, type: 'question' }, instruction: 'Initiate', scope });
    assert.equal(result, 'Hello there'); assert.equal(count, 1); assert.equal(c.chat.length, 1);
    assert.equal(config.stream_openai, true); assert.equal(config.function_calling, true); assert.equal(scope.retrieve, originalRetrieve); assert.equal(injected, 1);
    assert.deepEqual(tools, before); assert.ok([...e.handlers.values()].every(x => !x.length));
});
test('staging errors restore request hooks and reject empty output', async () => {
    const e = events(), c = { mainApi: 'openai', chat: [], chatCompletionSettings: { stream_openai: true }, getCharacterCardFields: () => ({}), substituteParams: x => x };
    const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'a', CHAT_COMPLETION_PROMPT_READY: 'b', CHAT_COMPLETION_SETTINGS_READY: 'c' }, Generate: async () => '{}', isGenerating: () => false };
    await assert.rejects(stageNormal({ host, ext: { extensionNames: [] }, tools: {}, c, attempt: { guard() {} }, instruction: 'a' }), /no usable/);
    assert.equal(c.chatCompletionSettings.stream_openai, true);
});
test('ST 1.19 source confirms structured normal output returns before saveReply and follow-up', async t => {
    let s;
    try { s = await readFile(process.env.ST_SCRIPT || new URL('../../research/st-1.19.0/public/script.js', import.meta.url), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') { t.skip('Set ST_SCRIPT to the verified ST 1.19.0 public/script.js for the source-contract check.'); return; } throw e; }
    const onSuccess = s.slice(s.indexOf('async function onSuccess(data)', s.indexOf('export async function Generate(')));
    assert.ok(onSuccess.indexOf('if (jsonSchema)') < onSuccess.indexOf('await saveReply'));
    assert.match(onSuccess, /if \(jsonSchema\) \{\s*unblockGeneration\(type\);\s*return extractJsonFromData/);
    assert.match(onSuccess, /returnInvalidJson: jsonSchema.returnInvalid/);
    assert.match(s, /if \(!result && returnInvalidJson\) \{\s*return text;/);
    assert.match(s, /!automatic_trigger.*send_if_empty/);
    assert.match(s, /export function setSendButtonState\(value\) \{\s*is_send_press = value;/);
    assert.match(s, /export function activateSendButtons\(\) \{\s*is_send_press = false;/);
    assert.ok(s.indexOf('is_send_press = true;', s.indexOf('export async function Generate(')) < s.indexOf('async function onSuccess(data)', s.indexOf('export async function Generate(')));
});

for (const [name, output, expected] of [
    ['JSON fence', '```json\n{"text":" Hello from a fence. "}\n```', 'Hello from a fence.'],
    ['unlabelled fence', '```\n{"text":"Hello again."}\n```', 'Hello again.'],
    ['plain prose', '  I have a question for you.  ', 'I have a question for you.'],
    ['object result', { text: ' A direct object. ' }, 'A direct object.'],
    ['boxed string', new String('{"text":"A boxed string."}'), 'A boxed string.'],
    ['empty object', '{}', null],
    ['fenced empty object', '```json\n{}\n```', null],
    ['malformed object', '{"text": unfinished', null],
    ['malformed array', '[unfinished', null],
    ['JSON array', '[{"text":"not the schema"}]', null],
    ['empty output', '   ', null],
    ['empty text', '{"text":" "}', null],
]) {
    test(`output fallback: ${name}`, async () => {
        const e = events(), c = { mainApi: 'openai', chatCompletionSettings: { stream_openai: true } }, tools = {};
        const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'a', CHAT_COMPLETION_PROMPT_READY: 'b', CHAT_COMPLETION_SETTINGS_READY: 'c' },
            Generate: async (_, options) => { assert.equal(options.jsonSchema.returnInvalid, true); return output; } };
        const run = () => stageNormal({ host, tools, c, attempt: { guard() {}, type: 'question' }, instruction: 'Initiate' });
        if (expected === null) await assert.rejects(run(), /no usable initiation/);
        else assert.equal(await run(), expected);
        assert.equal(c.chatCompletionSettings.stream_openai, true);
        assert.ok([...e.handlers.values()].every(x => !x.length));
    });
}

test('invalid preset JSON is tolerated without deleting exclusions', async () => {
    const e = events(), c = { mainApi: 'openai', chatCompletionSettings: { stream_openai: true } };
    const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'a', CHAT_COMPLETION_PROMPT_READY: 'b', CHAT_COMPLETION_SETTINGS_READY: 'c' },
        Generate: async () => {
            const req = { custom_include_body: 'not JSON', custom_exclude_body: 'keep' };
            await e.emit('c', req);
            assert.deepEqual(JSON.parse(req.custom_include_body), { venice_parameters: {
                include_venice_system_prompt: false, enable_web_search: 'off', enable_web_scraping: false } });
            assert.equal(req.custom_exclude_body, 'keep'); return '{"text":"Hello"}';
        } };
    assert.equal(await stageNormal({ host, tools: {}, c, attempt: { guard() {} }, instruction: 'Initiate' }), 'Hello');
});
function workerHarness(windows = []) {
    const handlers = {}, notifications = [], opened = [], waited = [];
    const scope = { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => { handlers[name] = fn; },
        registration: { showNotification: async (title, opts) => { notifications.push({ title, ...opts }); } },
        clients: { matchAll: async args => { assert.equal(args.includeUncontrolled, true); return windows; }, openWindow: async url => opened.push(url) } };
    installWorker(scope); return { handlers, notifications, opened, scope, waited };
}
test('worker generic notification has no private preview, per-chat tag replaces, focus existing PWA', async () => {
    const focused = [], messages = [], client = { id: 'pwa', url: 'https://example.test/', focus: async () => focused.push(true), postMessage: m => messages.push(m) };
    const h = workerHarness([client]); let pending;
    h.handlers.message({ source: { ...client, type: 'window' }, data: { kind: 'ava-notify', url: client.url, tag: 'chat1', key: 'a', preview: 'generic', text: 'private' }, waitUntil: p => { pending = p; } });
    await pending; assert.equal(h.notifications[0].body, undefined); assert.equal(h.notifications[0].tag, 'ava:chat1');
    h.handlers.notificationclick({ notification: { close() {}, data: h.notifications[0].data }, waitUntil: p => { pending = p; } });
    await pending; assert.equal(focused.length, 1); assert.equal(h.opened.length, 0); assert.equal(messages[0].kind, 'ava-notification-open');
});
test('worker opens only when no matching window exists, rejects foreign targets and no cache listeners', async () => {
    const h = workerHarness(); let pending;
    h.handlers.notificationclick({ notification: { close() {}, data: { url: 'https://example.test/', key: 'a' } }, waitUntil: p => { pending = p; } });
    await pending; assert.equal(h.opened.length, 1);
    h.handlers.notificationclick({ notification: { close() {}, data: { url: 'https://evil.test/' } }, waitUntil: p => { pending = p; } });
    await pending; assert.equal(h.opened.length, 1); assert.equal(h.handlers.fetch, undefined); assert.equal(h.handlers.push, undefined);
});

test('notification click prefers a registered PWA over the originating browser tab', async () => {
    const focused = [];
    const window = id => ({ id, type: 'window', url: 'https://example.test/', focus: async () => focused.push(id), postMessage() {} });
    const pwa = window('pwa'), tab = window('tab'), h = workerHarness([tab, pwa]); let pending;
    h.handlers.message({ source: pwa, data: { kind: 'ava-client', url: pwa.url, standalone: true } });
    h.handlers.message({ source: tab, data: { kind: 'ava-notify', url: tab.url, standalone: false, tag: 'a', key: 'a', preview: 'full', text: 'hello' }, waitUntil: p => { pending = p; } });
    await pending; assert.equal(h.notifications[0].body, 'hello');
    h.handlers.notificationclick({ notification: { close() {}, data: h.notifications[0].data }, waitUntil: p => { pending = p; } });
    await pending; assert.deepEqual(focused, ['pwa']); assert.equal(h.opened.length, 0);
});

test('unsupported generation backend is rejected before it can stream visibly', async () => {
    await assert.rejects(stageNormal({ c: { mainApi: 'textgenerationwebui' }, host: { Generate: () => assert.fail() } }), /Chat Completion/);
});

for (const [type, sulk, limit] of [['photo', false, 800], ['one-liner', false, 700], ['question', true, 400]]) {
    test(`reasoning budget: ${type}, sulk=${sulk} gets ${limit} tokens`, async () => {
        const e = events(), c = { mainApi: 'openai', chatCompletionSettings: { stream_openai: true } };
        const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'a', CHAT_COMPLETION_PROMPT_READY: 'b', CHAT_COMPLETION_SETTINGS_READY: 'c' },
            Generate: async () => {
                const req = { max_tokens: 5, max_completion_tokens: 5 }; await e.emit('c', req);
                assert.equal(req.max_tokens, limit); assert.equal(req.max_completion_tokens, limit);
                return '{"text":"A short opening"}';
            } };
        assert.equal(await stageNormal({ host, tools: {}, c, attempt: { guard() {}, type, sulk }, instruction: 'Initiate' }), 'A short opening');
    });
}
test('parse failure reports serialized raw output, bounded to 1000 characters', async () => {
    const e = events(), c = { mainApi: 'openai', chatCompletionSettings: {} };
    const output = '{"reasoning":"' + 'x'.repeat(2000);
    const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'a', CHAT_COMPLETION_PROMPT_READY: 'b', CHAT_COMPLETION_SETTINGS_READY: 'c' }, Generate: async () => output };
    await assert.rejects(stageNormal({ host, tools: {}, c, attempt: { guard() {} }, instruction: '' }), error => {
        assert.ok(error.message.includes('Raw output: ' + JSON.stringify(output).slice(0, 1000)));
        assert.ok(error.message.endsWith('… [truncated]')); assert.ok(error.message.length < 1100); return true;
    });
    host.Generate = async () => ({ text: 123, diagnostic: 'provider did not return text' });
    await assert.rejects(stageNormal({ host, tools: {}, c, attempt: { guard() {} }, instruction: '' }), /Raw output:.*provider did not return text/);
});
function activationFixture() {
    const worker = new EventTarget(); worker.state = 'installing';
    const registration = new EventTarget(); Object.assign(registration, { active: null, installing: worker, waiting: null });
    let timeout, cleared = 0;
    const options = { setTimer: fn => { timeout = fn; return 1; }, clearTimer: () => { cleared++; } };
    return { worker, registration, options, expire: () => timeout(), cleared: () => cleared };
}
test('notification activation waits for this registration, not merely active=activating', async () => {
    const f = activationFixture(); let resolved = false;
    const pending = waitForNotificationWorker(f.registration, f.options).then(w => { resolved = true; return w; });
    f.worker.state = 'activating'; f.registration.active = f.worker;
    f.worker.dispatchEvent(new Event('statechange')); await Promise.resolve(); assert.equal(resolved, false);
    f.worker.state = 'activated'; f.registration.installing = null;
    f.worker.dispatchEvent(new Event('statechange')); assert.equal(await pending, f.worker); assert.equal(f.cleared(), 1);
});
test('notification activation rejects redundant workers and bounded timeout', async () => {
    const f = activationFixture(); const p = waitForNotificationWorker(f.registration, f.options);
    f.worker.state = 'redundant'; f.worker.dispatchEvent(new Event('statechange'));
    await assert.rejects(p, /redundant/); assert.equal(f.cleared(), 1);
    const g = activationFixture(); const q = waitForNotificationWorker(g.registration, g.options);
    g.expire(); await assert.rejects(q, /timed out/); assert.equal(g.cleared(), 1);
});
test('page ready diagnostics log pending and late resolution without gating own worker', async () => {
    const messages = []; let expire, resolveReady;
    observeServiceWorkerReady({ ready: new Promise(r => { resolveReady = r; }) }, x => messages.push(x), {
        setTimer: fn => { expire = fn; return 1; }, clearTimer() {} });
    expire(); assert.ok(messages.some(x => x.includes('still pending')));
    resolveReady({ scope: '/other-pwa/' }); await Promise.resolve();
    assert.ok(messages.some(x => x.includes('resolved (/other-pwa/)')));
});
test('page ready rejection diagnostic is observed without unhandled rejection', async () => {
    const messages = [];
    observeServiceWorkerReady({ ready: Promise.reject(new Error('test failure')) }, x => messages.push(x), { setTimer: () => 1, clearTimer() {} });
    await Promise.resolve(); assert.ok(messages.some(x => x.includes('rejected (test failure)')));
});

test('a user generation reaches the model while an initiation is pending', async () => {
    const { fixture } = await import('./helpers.mjs');
    let draft = '', busy = false, release, ready;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { ready = resolve; });
    globalThis.document = { getElementById: () => ({ value: draft }) };
    const e = events(), tools = { canPerformToolCalls: () => true, registerFunctionToolsOpenAI: async () => {}, invokeFunctionTools: async () => 'user tool' };
    const originals = { ...tools }, requests = [];
    const f = fixture({ photoStatus: () => ({ ready: false }), deliver: async attempt => {
        await stageNormal({ host, tools, c: f.c, attempt, instruction: 'PRIVATE INITIATION' });
        assert.fail('An initiation superseded by a user send must not publish');
    } });
    Object.assign(f.c, { mainApi: 'openai', chatCompletionSettings: { stream_openai: true } });
    const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'commands', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'request' }, isGenerating: () => busy,
        async Generate(type, options = {}) {
            await e.emit('commands', type, options, false);
            const event = { chat: [{ role: 'user', content: 'My actual message' }] };
            await e.emit('prompt', event);
            const request = { messages: event.chat, stream: f.c.chatCompletionSettings.stream_openai, tools: ['user-tool'], max_tokens: 1200 };
            await e.emit('request', request);
            requests.push(request); // The model boundary, after every request hook.
            if (options.automatic_trigger) { ready(); await pending; return '{"text":"Late initiation"}'; }
            assert.deepEqual(tools, originals);
            return 'User reply reached the model';
        } };
    const task = f.engine.tick(true);
    await started;
    assert.ok(f.state().pending); assert.ok(f.state().attempt);
    draft = 'My actual message'; busy = true;
    try {
        assert.equal(await host.Generate('normal', {}), 'User reply reached the model');
        assert.equal(requests.length, 2);
        assert.deepEqual(requests[1], { messages: [{ role: 'user', content: 'My actual message' }], stream: true, tools: ['user-tool'], max_tokens: 1200 });
    } finally { release(); await task; }
    assert.equal(f.c.chat.length, 0);
    assert.equal(f.engine.fatal, null);
    assert.ok([...e.handlers.values()].every(list => !list.length));
});

test('dry runs bypass the initiation entry guard; own busy check still throws and cleans up', async () => {
    globalThis.document = { getElementById: () => ({ value: 'draft' }) };
    const e = events(), tools = {}, c = { mainApi: 'openai', chatCompletionSettings: { stream_openai: true } };
    let guards = 0;
    const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'commands', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'request' }, isGenerating: () => true,
        async Generate(type, options) {
            const before = guards;
            await assert.doesNotReject(e.emit('commands', 'normal', {}, true));
            assert.equal(guards, before);
            await e.emit('commands', type, options, false);
            assert.fail('The initiation must stop for a draft/busy composer');
        } };
    await assert.rejects(stageNormal({ host, tools, c, attempt: { guard() { guards++; } }, instruction: 'Initiate' }), /Composer or generation became busy/);
    assert.equal(c.chatCompletionSettings.stream_openai, true);
    assert.ok([...e.handlers.values()].every(list => !list.length));
    host.Generate = async () => { throw new Error('Provider unavailable'); };
    await assert.rejects(stageNormal({ host, tools, c, attempt: { guard() {} }, instruction: 'Initiate' }), /Provider unavailable/);
    host.Generate = async () => '{"text":"Recovered"}';
    assert.equal(await stageNormal({ host, tools, c, attempt: { guard() {} }, instruction: 'Initiate' }), 'Recovered');
});

test('tool-result continuation event sequence consumes entry guard once and delivers the final initiation', async () => {
    const { fixture } = await import('./helpers.mjs');
    globalThis.document = { getElementById: () => ({ value: '' }) };
    const e = events(); let busy = false, passes = 0;
    const tools = { canPerformToolCalls: () => true, registerFunctionToolsOpenAI: async () => {}, invokeFunctionTools: async () => {} };
    const original = { ...tools };
    const f = fixture({ photoStatus: () => ({ ready: false }), deliver: async attempt => {
        const text = await stageNormal({ host, tools, c: f.c, attempt, instruction: 'Initiate' });
        const message = { mes: text, extra: { ava_initiation: { attemptId: attempt.id } } };
        f.c.chat.push(message); attempt.onPublished(f.c.chat.length - 1, message);
    } });
    Object.assign(f.c, { mainApi: 'openai', chatCompletionSettings: { stream_openai: true } });
    const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'commands', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'request' }, isGenerating: () => busy,
        async Generate(type, options) {
            passes++;
            await e.emit('commands', type, options, false);
            const prompt = { chat: [{ role: 'user', content: 'Previous exchange' }] };
            await e.emit('prompt', prompt);
            const request = { messages: prompt.chat, stream: true };
            await e.emit('request', request);
            assert.equal(request.stream, false);
            if (passes === 1) {
                busy = true;
                // Model a host/tool-result recursion. No real tool is invoked:
                // initiations deliberately retain their existing no-tool policy.
                return host.Generate('normal', { automatic_trigger: options.automatic_trigger, depth: 1 });
            }
            assert.equal(busy, true, 'ST is still generating at the recursive entry');
            return '{"text":"A new opening after the continuation."}';
        } };
    await f.engine.tick(true);
    assert.equal(passes, 2);
    assert.equal(f.c.chat.length, 1);
    assert.equal(f.c.chat[0].mes, 'A new opening after the continuation.');
    assert.equal(f.state().state, 'sent'); assert.equal(f.engine.fatal, null);
    assert.equal(f.db.log.filter(r => r.outcome === 'sent').length, 1);
    assert.deepEqual(tools, original);
    assert.equal(f.c.chatCompletionSettings.stream_openai, true);
    assert.ok([...e.handlers.values()].every(list => !list.length));
});

test('prompt assembly failure releases ST busy flag so the next user send runs', async () => {
    globalThis.document = { getElementById: () => ({ value: '' }) };
    const e = events(), c = { mainApi: 'openai', chatCompletionSettings: { stream_openai: true } };
    let busy = false, userRequests = 0;
    const host = { eventSource: e, event_types: { GENERATION_STARTED: 'start', GENERATION_AFTER_COMMANDS: 'commands', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'request' },
        isGenerating: () => busy, setSendButtonState: value => { busy = value; },
        async Generate(type, options) {
            await e.emit('start', type, options, false);
            await e.emit('commands', type, options, false);
            busy = true; // ST sets this before prompt assembly, outside its network catch.
            if (options.automatic_trigger) throw new Error('Prompt assembly failed');
            userRequests++; busy = false; return 'User reply';
        } };
    await assert.rejects(stageNormal({ host, tools: {}, c, attempt: { guard() {} }, instruction: '' }), /Prompt assembly failed/);
    assert.equal(busy, false, 'Send must not silently return due to the abandoned initiation flag');
    assert.equal(await host.Generate('normal', {}), 'User reply'); assert.equal(userRequests, 1);
    assert.equal(c.chatCompletionSettings.stream_openai, true);
});

test('user generation handoff revokes cancellation ownership before MESSAGE_SENT and late cleanup', async () => {
    globalThis.document = { getElementById: () => ({ value: '' }) };
    const e = events(), tools = { canPerformToolCalls: () => true }, original = { ...tools };
    const c = { mainApi: 'openai', chatCompletionSettings: { stream_openai: true } };
    let release, started, cancel, oldCancel, busy = false, owned = true, stops = 0;
    const pending = new Promise(r => { release = r; }), ready = new Promise(r => { started = r; });
    const host = { eventSource: e, event_types: { GENERATION_STARTED: 'start', GENERATION_AFTER_COMMANDS: 'commands', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'request' },
        isGenerating: () => busy, setSendButtonState: value => { busy = value; }, stopGeneration: () => { stops++; },
        async Generate(type, options) {
            await e.emit('start', type, options, false); await e.emit('commands', type, options, false);
            busy = true; started(); await pending; return '{"text":"Stale initiation"}';
        } };
    const task = stageNormal({ host, tools, c, attempt: { guard() {} }, instruction: '',
        onRelease: () => { owned = false; }, onCancelReady: fn => { cancel = fn; } });
    await ready; oldCancel = cancel;
    await e.emit('start', 'normal', { automatic_trigger: false }, false);
    assert.equal(owned, false); assert.deepEqual(tools, original);
    // MESSAGE_SENT coordinator cancellation must no longer own ST's stop control.
    if (owned) cancel();
    oldCancel(); assert.equal(stops, 0);
    busy = true; release(); await assert.rejects(task, /superseded/);
    assert.equal(busy, true, 'late initiation finally must preserve the real user generation');
    assert.equal(c.chatCompletionSettings.stream_openai, true);
});

test('cancelled pending initiation removes global hooks immediately, before Generate settles', async () => {
    globalThis.document = { getElementById: () => ({ value: '' }) };
    const e = events(), tools = { canPerformToolCalls: () => true }, original = { ...tools };
    const c = { mainApi: 'openai', chatCompletionSettings: { stream_openai: true } };
    let cancel, release, started, busy = false, cancelled = false, stops = 0;
    const pending = new Promise(r => { release = r; }), ready = new Promise(r => { started = r; });
    const host = { eventSource: e, event_types: { GENERATION_AFTER_COMMANDS: 'commands', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'request' },
        isGenerating: () => busy, setSendButtonState: value => { busy = value; }, stopGeneration: () => { stops++; },
        async Generate(type, options) { await e.emit('commands', type, options, false); busy = true; started(); await pending; return '{"text":"Too late"}'; } };
    const task = stageNormal({ host, tools, c, attempt: { guard() { if (cancelled) throw new Error('Cancelled'); } }, instruction: '', onCancelReady: fn => { cancel = fn; } });
    await ready; cancelled = true; cancel();
    assert.deepEqual(tools, original); assert.equal(c.chatCompletionSettings.stream_openai, true);
    assert.ok([...e.handlers.values()].every(list => !list.length)); assert.equal(stops, 1);
    release(); await assert.rejects(task, /Cancelled/); assert.equal(busy, false);
});

test('chat wake returns immediately, coalesces repeated events and contains activation errors', async () => {
    let seq = 0, calls = 0, refreshed = 0, release;
    const timers = new Map(), failures = [];
    const pending = new Promise(r => { release = r; });
    const wake = createWakeLoop({ activate: async () => { calls++; if (calls === 1) await pending; else throw new Error('Wake failed'); },
        refresh: () => { refreshed++; }, onError: e => failures.push(e.message),
        setTimer: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; }, clearTimer: id => timers.delete(id) });
    assert.equal(wake(), undefined); wake(); wake(); assert.equal(timers.size, 1);
    const first = [...timers.values()][0]; timers.clear(); const run = first.fn();
    assert.equal(wake(), undefined); wake(); assert.equal(calls, 1);
    release(); await run; assert.equal(refreshed, 1); assert.equal(timers.size, 1);
    const second = [...timers.values()][0]; timers.clear(); assert.equal(second.ms, 0);
    await second.fn(); assert.deepEqual(failures, ['Wake failed']); assert.equal(refreshed, 2);
    assert.equal(timers.size, 1); assert.equal([...timers.values()][0].ms, 5000);
});
