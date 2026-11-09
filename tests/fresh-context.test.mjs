import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverOpening, openingInstruction, stageNormal } from '../index.js';

function adapterFixture(messages) {
    const callbacks = new Map(), requests = [];
    const eventSource = {
        makeLast(name, fn) { callbacks.set(name, [...(callbacks.get(name) || []), fn]); },
        removeListener(name, fn) { callbacks.set(name, (callbacks.get(name) || []).filter(f => f !== fn)); },
        async emit(name, ...args) { for (const fn of [...(callbacks.get(name) || [])]) await fn(...args); },
    };
    const c = { mainApi: 'openai', chat: [], chatCompletionSettings: { stream_openai: true, temperature: .7 } };
    const host = { eventSource, isGenerating: () => false,
        event_types: { GENERATION_AFTER_COMMANDS: 'entry', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'settings' },
        async Generate(type, options) {
            await eventSource.emit('entry', type, options, false);
            const event = { chat: structuredClone(messages) };
            await eventSource.emit('prompt', event);
            const request = { messages: event.chat, temperature: c.chatCompletionSettings.temperature };
            await eventSource.emit('settings', request); requests.push(request);
            return '{"text":"Fancy choosing some music for tonight?"}';
        },
    };
    return { c, host, callbacks, requests };
}

test('the actual opening pipeline keeps an answered user turn answered and appends one private task', async () => {
    globalThis.document = { getElementById: () => ({ value: '' }) };
    const messages = [
        { role: 'system', content: 'Character description and established world.' },
        { role: 'user', content: 'What did you think of that film?' },
        { role: 'assistant', content: 'The ending was far too predictable.' },
    ];
    const f = adapterFixture(messages);
    f.c.chat = [{ is_user: true, mes: messages[1].content }, { is_user: false, mes: messages[2].content }];
    const transcript = structuredClone(f.c.chat), published = [];
    const attempt = { c: f.c, type: 'question', history: '[]', guard() {} };
    await deliverOpening({ attempt,
        generate: instruction => stageNormal({ ...f, tools: {}, attempt, instruction }),
        publishText: async text => published.push(text), publishPhoto: () => assert.fail(),
    });
    assert.equal(f.requests.length, 1);
    const request = f.requests[0];
    assert.deepEqual(request.messages.slice(0, -1), messages);
    assert.equal(request.messages.at(-1).role, 'user');
    assert.match(request.messages.at(-1).content, /Private initiation task, not a new message/);
    assert.match(request.messages.at(-1).content, /No new user message has arrived/);
    assert.match(request.messages.at(-1).content, /Do not answer the user's previous message again, even with different wording/);
    assert.match(request.messages.at(-1).content, /Start a fresh subject/);
    assert.equal(request.temperature, .7);
    assert.deepEqual(f.c.chat, transcript, 'the private cue is never written as a user message');
    assert.deepEqual(published, ['Fancy choosing some music for tonight?']);
    assert.ok([...f.callbacks.values()].every(list => list.length === 0));
    const subsequent = { chat: structuredClone(messages) };
    await f.host.eventSource.emit('prompt', subsequent);
    assert.deepEqual(subsequent.chat, messages, 'ordinary generations inherit no initiation instruction');
});

test('tool-call history and a multimodal last reply survive request assembly unchanged', async () => {
    globalThis.document = { getElementById: () => ({ value: '' }) };
    const messages = [
        { role: 'user', content: 'Do you remember the song?' },
        { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'SearchWrittenMemories', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: 'An existing memory.' },
        { role: 'assistant', content: [{ type: 'text', text: 'Yes, that one.' }, { type: 'image_url', image_url: { url: '/photo.png' } }] },
        { role: 'system', content: 'Existing state tracker.' },
    ];
    const f = adapterFixture(messages), attempt = { guard() {}, type: 'photo' };
    await stageNormal({ ...f, tools: {}, attempt, instruction: 'Private photo task.' });
    assert.deepEqual(f.requests[0].messages.slice(0, -1), messages);
    assert.deepEqual(f.requests[0].messages.at(-1), { role: 'user', content: 'Private photo task.' });
});

test('all initiation types keep the exact supplied repetition sentence within the fresh-task instruction', () => {
    for (const type of ['photo', 'question', 'complaint', 'demand', 'one-liner']) {
        const instruction = openingInstruction({ type, history: '[]' }, 'Her earlier reply.');
        assert.ok(instruction.includes("Do not repeat, continue or lightly reword your own last message. It was: 'Her earlier reply.'. Write something new."));
        assert.match(instruction, /preceding exchange is completed history/);
        assert.match(instruction, /Start a fresh subject/);
    }
});
