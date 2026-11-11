import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { RECOVERY_ONLY, RECOVERY_NOTICE, MINUTE, chatKey } from '../index.js';
import { fixture } from './helpers.mjs';

test('paused engine ignores saved enabled, overdue pending jobs, manual fire and reply mutations', async () => {
    let paused = false, locks = 0;
    const f = fixture({ paused: () => paused });
    await f.engine.activate();
    f.advance(240 * MINUTE);
    f.c.chat.push({ is_user: true, mes: 'normal chat' });
    const before = structuredClone(f.db), chatBefore = structuredClone(f.c.chat);
    paused = true;
    f.d.locks = { request() { locks++; throw Error('must not acquire locks'); } };
    for (let n = 0; n < 10; n++) { await f.engine.tick(); await f.engine.tick(true); await f.engine.tick(true, true); await f.engine.activate(); }
    await f.engine.reply(0); await f.engine.markRead(); await f.engine.updateConfig({ ...f.db.config, enabled: false });
    assert.equal(locks, 0); assert.equal(f.deliveries.length, 0); assert.equal(f.timers.size, 0);
    assert.deepEqual(f.db, before); assert.deepEqual(f.c.chat, chatBefore);
    assert.equal(f.engine.snapshot().config.enabled, true, 'saved settings retained');
    assert.equal(f.engine.running, null); assert.equal(f.notices.at(-1), RECOVERY_NOTICE);
});

// Execute the actual bootPage with DOM/module boundaries stubbed. All effects
// that a recovery-only boot must avoid throw immediately if touched.
test('actual recovery boot and chat switches stay inert; diagnostics copy works with saved enable flags on', async () => {
    assert.equal(RECOVERY_ONLY, true);
    const f = fixture();
    await f.engine.activate();
    const db = f.db; db.config.browserNotifications = true; db.config.telegramEnabled = true;
    db.log.push({ timestamp: 1, chat: chatKey(f.c), outcome: 'failed', attemptId: 'old', type: 'question', text: 'Stored original failure' });
    db.chats[chatKey(f.c)].nextAt = 0;
    const saved = JSON.stringify(db), storage = new Map([['ava-initiation:v1:test:data', saved]]);
    const nodes = new Map(), handlers = [], calls = [];
    class Node {
        constructor(id = '') { this.id = id; this.children = []; this.isConnected = true; this.dataset = {}; this.type = ''; }
        append(x) { this.children.push(x); }
        setAttribute() {}
        remove() {}
        querySelector(q) { return node(q); }
        querySelectorAll(q) { return q === '[data-setting]' ? [enabled] : q === 'input, select, button' ? [enabled, node('#ava-fire'), node('#ava-read'), node('#ava-telegram-test'), node('#ava-allow'), node('#ava-copy-trace')] : []; }
    }
    function node(q) { if (!nodes.has(q)) nodes.set(q, new Node(q.replace(/^#/, ''))); return nodes.get(q); }
    const enabled = node('[data-setting=enabled]'); enabled.type = 'checkbox'; enabled.dataset.setting = 'enabled';
    const forbidden = name => () => { calls.push(name); throw Error('Forbidden recovery effect: ' + name); };
    const host = { event_types: { CHAT_CHANGED: 'chat', MESSAGE_SENT: 'sent', GENERATION_STOPPED: 'stop' },
        eventSource: { on: (type, fn) => handlers.push([type, fn]) },
        Generate: forbidden('Generate'), stopGeneration: forbidden('stop'), saveSettingsDebounced: forbidden('save-settings') };
    let copied;
    const sandbox = vm.createContext({ console, structuredClone, URL, TextEncoder, TextDecoder,
        crypto: { randomUUID: () => 'uuid', getRandomValues: x => x.fill(1) },
        navigator: { locks: { request: forbidden('lock') }, clipboard: { writeText: async text => { copied = text; } }, serviceWorker: { register: forbidden('worker') } },
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: forbidden('storage-write'), removeItem: forbidden('storage-remove') },
        document: { getElementById: id => node('#' + id), createElement: () => new Node(), querySelectorAll: () => [], body: new Node(), activeElement: null },
        fetch: forbidden('fetch'), setTimeout: forbidden('timer'), clearTimeout() {},
    });
    const modules = {
        '../../../../script.js': host,
        '../../../extensions.js': { getContext: () => ({ ...f.c, characterId: 0, characters: [{ avatar: 'A' }] }), extension_settings: { 'ava-initiation': db.config } },
        '../../../tool-calling.js': { ToolManager: {} }, '../../../chats.js': {},
        '../../../user.js': { getCurrentUserHandle: () => 'test' }, '../../../constants.js': {},
    };
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source, { context: sandbox, initializeImportMeta(meta) { meta.url = 'https://example.test/index.js'; },
        importModuleDynamically: async specifier => {
            const values = modules[specifier]; assert.ok(values, specifier);
            const mod = new vm.SyntheticModule(Object.keys(values), function() { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context: sandbox });
            await mod.link(() => {}); await mod.evaluate(); return mod;
        } });
    await module.link(() => {}); await module.evaluate();
    const result = await module.namespace.bootPage();
    assert.equal(result.recoveryOnly, true);
    assert.equal(enabled.checked, false); assert.equal(enabled.disabled, true);
    assert.equal(node('#ava-fire').disabled, true); assert.equal(node('#ava-telegram-test').disabled, true);
    assert.equal(node('#ava-copy-trace').disabled, false);
    assert.deepEqual(handlers.map(x => x[0]), ['chat']);
    for (let i = 0; i < 20; i++) handlers[0][1]();
    await node('#ava-copy-trace').onclick();
    assert.match(copied, /Stored original failure/);
    assert.equal(node('#ava-trace-copy').value, copied);
    assert.deepEqual(calls, []); assert.equal(storage.get('ava-initiation:v1:test:data'), saved);
    assert.equal(result.engine.snapshot().config.enabled, true);
});
