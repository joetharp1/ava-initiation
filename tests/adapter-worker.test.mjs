import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stageNormal, installWorker } from '../index.js';
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
