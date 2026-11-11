import test from 'node:test';
import assert from 'node:assert/strict';
import { publishDiagnosticText } from '../index.js';
function fixture({ saveError, silentSave = false, readError, eventError } = {}) {
    const calls = [], trace = [], original = [{ name: 'Joe', is_user: true, mes: 'Earlier user turn' }, { name: 'Ava', mes: 'Earlier completed answer' }];
    let saved = structuredClone(original), reads = 0, cancelled = false;
    const c = { name2: 'Ava', chat: structuredClone(original), addOneMessage: m => calls.push(['render', m]),
        saveChat: async () => { calls.push(['save']); if (saveError) throw saveError; if (!silentSave) saved = structuredClone(c.chat); } };
    const host = { getRequestHeaders: () => ({ fixture: true }), event_types: { MESSAGE_RECEIVED: 'received', CHARACTER_MESSAGE_RENDERED: 'rendered' },
        eventSource: { emit: async (name, id, type) => { calls.push([name, id, type]); if (eventError) throw eventError; } } };
    const job = { id: 'test-id', c, guard: () => { if (cancelled) throw Error('cancelled'); }, trace: (...x) => trace.push(x) };
    const options = { job, text: 'Shall we take a walk by the canal?', host, now: () => 12345,
        readChat: async () => { calls.push(['read']); reads++; if (reads === 2 && readError) throw readError; return saved; } };
    return { options, calls, trace, c, get saved() { return saved; }, set saved(v) { saved = v; }, cancel: () => { cancelled = true; } };
}

test('one text message is rendered, emitted, saved and verified in order', async () => {
    const f = fixture(); await publishDiagnosticText(f.options);
    assert.deepEqual(f.calls.map(x => x[0]), ['read', 'render', 'received', 'rendered', 'save', 'read']);
    assert.equal(f.c.chat.length, 3); assert.equal(f.saved.length, 3);
    assert.deepEqual(f.c.chat.at(-1).extra.ava_initiation, { attemptId: 'test-id', type: 'question', timestamp: 12345, diagnosticDelivery: true });
    assert.equal(f.trace.at(-1)[0], 'text-delivered');
});

test('silent save failure is not reported as success and does not duplicate or regenerate', async () => {
    const f = fixture({ silentSave: true });
    await assert.rejects(publishDiagnosticText(f.options), /server save is not confirmed/);
    assert.equal(f.c.chat.length, 3); assert.equal(f.saved.length, 2);
    assert.equal(f.calls.filter(x => x[0] === 'save').length, 1);
    assert.equal(f.trace.some(x => x[0] === 'text-delivered'), false);
    assert.equal(f.trace.at(-1)[0], 'delivery-unconfirmed');
    await assert.rejects(publishDiagnosticText(f.options), /No duplicate added/);
    assert.equal(f.c.chat.length, 3);
});

test('a stale server history or repeated opening is rejected before any local write', async () => {
    const stale = fixture(); stale.saved = [...stale.saved, { mes: 'A reply from another tab' }];
    await assert.rejects(publishDiagnosticText(stale.options), /different chat history/);
    assert.deepEqual(stale.calls.map(x => x[0]), ['read']); assert.equal(stale.c.chat.length, 2);
    const repeat = fixture(); repeat.options.text = 'Earlier completed answer';
    await assert.rejects(publishDiagnosticText(repeat.options), /Repeated opening withheld/);
    assert.equal(repeat.calls.length, 0); assert.equal(repeat.c.chat.length, 2);
});

test('event, save and verification errors retain their specific error and last completed stage', async () => {
    for (const cause of ['eventError', 'saveError', 'readError']) {
        const error = new Error(`${cause} fixture`), f = fixture({ [cause]: error });
        await assert.rejects(publishDiagnosticText(f.options), e => e === error);
        assert.equal(f.trace.at(-1)[0], 'delivery-unconfirmed');
        assert.match(f.trace.at(-1)[1], new RegExp(cause));
        assert.equal(f.trace.some(x => x[0] === 'text-delivered'), false);
    }
});

test('cancellation during an event prevents later events and save', async () => {
    const f = fixture(); f.options.host.eventSource.emit = async () => { f.cancel(); };
    await assert.rejects(publishDiagnosticText(f.options), /cancelled/);
    assert.equal(f.calls.some(x => x[0] === 'save'), false);
    assert.equal(f.trace.some(x => x[0] === 'text-delivered'), false);
});
