import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegram, validTelegramToken, validateConfig, DEFAULTS } from '../index.js';
const token = '123456789:TEST_ONLY_NOT_A_REAL_TOKEN_12345';
const args = { token, chatId: '-123456789', text: 'Private message', preview: 'full' };
const ok = async () => ({ ok: true, json: async () => ({ ok: true }) });
test('Telegram is opt-in and token cannot enter scheduler/synced config', () => {
    assert.equal(DEFAULTS.telegramEnabled, false); assert.equal(DEFAULTS.browserNotifications, false);
    const cfg = validateConfig({ telegramToken: token, telegramChatId: ' -123456789 ' });
    assert.equal(cfg.telegramChatId, '-123456789'); assert.equal(Object.hasOwn(cfg, 'telegramToken'), false);
    assert.throws(() => validateConfig({ telegramChatId: 'path/not-a-chat' }));
});
test('Telegram sends a form POST with no cookies, referrer, redirect or markup parsing', async () => {
    let calls = 0;
    await sendTelegram(args, { fetcher: async (url, options) => {
        calls++; assert.equal(url, `https://api.telegram.org/bot${token}/sendMessage`);
        assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'omit');
        assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.redirect, 'error');
        assert.ok(options.body instanceof URLSearchParams);
        assert.deepEqual(Object.fromEntries(options.body), { chat_id: args.chatId, text: args.text,
            disable_notification: 'false', link_preview_options: '{"is_disabled":true}' });
        return ok();
    } }); assert.equal(calls, 1);
});
test('Generic Telegram preview sends Ava only, silently', async () => {
    await sendTelegram({ ...args, preview: 'generic' }, { fetcher: async (_, { body }) => {
        assert.equal(body.get('text'), 'Ava'); assert.equal(body.get('disable_notification'), 'true');
        assert.ok(!body.toString().includes('Private')); return ok();
    } });
});
test('Full preview truncates to 200 Unicode characters without splitting emoji', async () => {
    await sendTelegram({ ...args, text: '🙂'.repeat(210) }, { fetcher: async (_, { body }) => {
        assert.equal(body.get('text'), '🙂'.repeat(200)); return ok();
    } });
});
test('Photo without text has a usable full preview', async () => {
    await sendTelegram({ ...args, text: '' }, { fetcher: async (_, { body }) => {
        assert.equal(body.get('text'), '[Photo]'); return ok();
    } });
});
for (const [name, fetcher] of [
    ['HTTP failure', async () => ({ ok: false, status: 401 })],
    ['API failure', async () => ({ ok: true, json: async () => ({ ok: false, description: token }) })],
    ['malformed response', async () => ({ ok: true, json: async () => { throw Error(token); } })],
    ['network failure', async () => { throw Error(`Failed https://api.telegram.org/bot${token}/sendMessage`); }],
]) test(`Telegram ${name} is sanitized and never retried`, async () => {
    let calls = 0;
    await assert.rejects(sendTelegram(args, { fetcher: (...x) => { calls++; return fetcher(...x); } }), error => {
        assert.ok(!error.message.includes(token)); assert.ok(!error.message.includes('https://'));
        assert.match(error.message, /unread badge retained/); return true;
    }); assert.equal(calls, 1);
});
test('Hung Telegram fetch is bounded and aborted', async () => {
    let signal;
    await assert.rejects(sendTelegram(args, { timeoutMs: 10, fetcher: async (_, options) => {
        signal = options.signal; return new Promise(() => {});
    } }), /timed out/); assert.equal(signal.aborted, true);
});
test('Missing or malformed credentials never dispatch a request', async () => {
    assert.equal(validTelegramToken(token), true); assert.equal(validTelegramToken('123:bad/path'), false);
    for (const override of [{ token: '' }, { token: 'x/y' }, { chatId: '' }, { chatId: '1&text=other' }]) {
        await assert.rejects(sendTelegram({ ...args, ...override }, { fetcher: () => assert.fail('No request allowed') }), /saved bot token and chat ID/);
    }
});
