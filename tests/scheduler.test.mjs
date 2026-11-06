import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, initialDatabase, chatKey, MINUTE, DEADLINE, quietAt, dayWindow, historyWithinTokens, photoCostMicros } from '../index.js';

import { fixture } from './helpers.mjs';

test('automatic default off and per-character allowlist off; no delivery', async () => {
    const f = fixture(); f.db = initialDatabase(); await f.engine.tick(true); assert.equal(f.deliveries.length, 0);
    f.db.config.enabled = true; await f.engine.tick(true); assert.equal(f.deliveries.length, 0);
});
test('one normal send, no follow-up, sulk once at 25 minutes, reply resets', async () => {
    const f = fixture(); await f.engine.tick(); f.advance(MINUTE); await f.engine.tick();
    assert.equal(f.deliveries.length, 1); assert.equal(f.state().state, 'sent');
    f.advance(24 * MINUTE); await f.engine.tick(); assert.equal(f.deliveries.length, 1);
    f.advance(MINUTE); await f.engine.tick(); assert.equal(f.deliveries.length, 2); assert.equal(f.deliveries[1].sulk, true);
    assert.notEqual(f.deliveries[1].type, 'photo'); assert.notEqual(f.deliveries[0].type, f.deliveries[1].type);
    f.advance(60 * MINUTE); await f.engine.tick(); assert.equal(f.deliveries.length, 2);
    f.c.chat.push({ is_user: true, mes: 'hello' }); await f.engine.reply(f.c.chat.length - 1);
    assert.equal(f.state().state, 'waiting'); assert.equal(f.state().sulkUsed, false);
    assert.equal(f.state().unansweredAt, null);
});
test('two-photo cap across companions, text continues and consecutive types differ', async () => {
    const f = fixture(); await f.engine.tick(true); await f.engine.tick(true); await f.engine.tick(true);
    assert.equal(f.db.budget.attempts, 2); assert.equal(f.db.budget.spent, 120000);
    f.switch(); await f.engine.activate(); await f.engine.tick(true);
    assert.notEqual(f.deliveries.at(-1).type, 'photo'); assert.equal(f.deliveries.length, 4);
    assert.ok(f.deliveries.slice(1, 3).every((a, i) => a.type !== f.deliveries[i].type));
});
test('lower daily credit cap disables only photo, resets at local midnight', async () => {
    const f = fixture(); f.db.config.creditUsd = .06;
    await f.engine.tick(true); await f.engine.tick(true); await f.engine.tick(true);
    assert.equal(f.deliveries.filter(x => x.type === 'photo').length, 1);
    f.c.chat.push({ is_user: true, mes: 'hello' }); await f.engine.reply(f.c.chat.length - 1);
    f.setTime(f.db.budget.end + 1); await f.engine.tick(true);
    assert.equal(f.db.budget.attempts, 1); assert.equal(f.deliveries.at(-1).type, 'photo');
});
test('budget uses higher catalogue price and rejects unknown costs', async () => {
    const f = fixture({ photoStatus: () => ({ ready: true, costUsd: .20 }) });
    await f.engine.tick(true); assert.notEqual(f.deliveries[0].type, 'photo');
    assert.equal(photoCostMicros(null), null); assert.equal(photoCostMicros(.03), 60000);
});
test('provider failure keeps reservation, backoff, no photo retry for same slot', async () => {
    let count = 0;
    const f = fixture({ deliver: async a => { if (a.type === 'photo') a.reservePhoto(.06); count++; throw new Error('provider failed'); } });
    await f.engine.tick(true); assert.equal(f.db.budget.attempts, 1); assert.equal(f.state().state, 'waiting');
    await f.engine.tick(); assert.equal(count, 1);
    f.advance(MINUTE); await f.engine.tick(); assert.equal(count, 2); assert.equal(f.db.budget.attempts, 1);
    assert.equal(f.state().retryAt - f.d.now(), 2 * MINUTE);
    for (let i = 0; i < 8; i++) { f.advance(30 * MINUTE); await f.engine.tick(); }
    assert.equal(f.state().retryAt - f.d.now(), 30 * MINUTE);
});
test('quiet overnight backlog, at most one on wake and missed slots audited', async () => {
    const f = fixture(); f.db.config.quietStart = '23:00'; f.db.config.quietEnd = '08:00';
    f.setTime(new Date(2026, 10, 6, 22, 59).getTime()); await f.engine.tick();
    f.advance(3 * MINUTE); await f.engine.tick(); assert.equal(f.deliveries.length, 0);
    f.setTime(new Date(2026, 10, 7, 8, 0).getTime()); await f.engine.tick();
    assert.equal(f.deliveries.length, 1); assert.ok(f.db.log.some(r => r.outcome === 'missed'));
    assert.equal(f.db.log.length, 200);
});
test('Fire now overrides quiet and unanswered but respects drafts', async () => {
    const f = fixture(); f.db.config.quietStart = '00:00'; f.db.config.quietEnd = '23:59';
    await f.engine.tick(true); await f.engine.tick(true); assert.equal(f.deliveries.length, 2);
    f.block(true); await f.engine.tick(true); assert.equal(f.deliveries.length, 2);
});
test('draft and generation deferral has a single ten-minute cap despite new slots', async () => {
    const f = fixture(); f.block(true); await f.engine.tick(true);
    for (let i = 0; i < 10; i++) { f.advance(MINUTE); await f.engine.tick(); }
    assert.equal(f.deliveries.length, 0); assert.ok(f.db.log.some(r => r.outcome === 'skipped'));
    assert.equal(f.state().pending, null);
});
test('draft expires during suspension even if composer is empty on wake', async () => {
    const f = fixture(); f.block(true); await f.engine.tick(true);
    f.advance(11 * MINUTE); f.block(false); await f.engine.tick();
    assert.equal(f.deliveries.length, 0); assert.equal(f.state().pending, null);
});
test('missing Web Locks visibly disables manual and timer generation', async () => {
    const f = fixture({ locks: null }); await f.engine.tick(true);
    assert.equal(f.deliveries.length, 0); assert.match(f.notices.at(-1), /Web Locks/);
});
test('real lock prevents two concurrent windows from delivering twice', async () => {
    let release;
    const f = fixture({ deliver: () => new Promise(r => { release = r; }) });
    const second = createEngine(f.d);
    const first = f.engine.tick(true); await new Promise(r => setImmediate(r));
    await second.tick(true); assert.equal(f.c.chat.length, 0); assert.match(f.notices.at(-1), /another window/);
    release(); await first; assert.equal(f.db.log.filter(x => x.outcome === 'failed').length, 1);
});
test('timeout cancels once and late publication is fenced; state never sent', async () => {
    let a, finish;
    const f = fixture({ deliver: attempt => { a = attempt; return new Promise(r => { finish = r; }); } });
    const pending = f.engine.tick(true); await new Promise(r => setImmediate(r));
    f.advance(DEADLINE); f.fireTimers(); await pending;
    assert.equal(f.cancels.length, 1); assert.notEqual(f.state().state, 'sent');
    assert.throws(() => a.guard(), /expired/); assert.throws(() => a.reservePhoto(.06), /expired/);
    finish(); await new Promise(r => setImmediate(r)); assert.equal(f.c.chat.length, 0);
});
test('chat switch cancels old attempt and isolates new chat state', async () => {
    let a;
    const f = fixture({ deliver: attempt => { a = attempt; return new Promise(() => {}); } });
    await f.engine.activate(); const pending = f.engine.tick(true); await new Promise(r => setImmediate(r));
    f.switch(); await f.engine.activate(); await pending;
    assert.throws(() => a.guard(), /expired/); assert.equal(f.c.chat.length, 0);
    assert.equal(f.db.log.at(-1).chat, JSON.stringify(['A', 'a']));
});
test('confirmed delivery survives save failure without replay', async () => {
    const f = fixture(); const original = f.d.deliver;
    f.d.deliver = async a => { await original(a); throw new Error('save failed'); };
    await f.engine.tick(true); assert.equal(f.state().state, 'sent');
    assert.equal(f.db.log.filter(x => x.outcome === 'sent').length, 1);
    await f.engine.tick(); assert.equal(f.c.chat.length, 1);
});
test('reload reconciles confirmed attempt by message ID', async () => {
    const f = fixture(); await f.engine.tick(true);
    const sent = f.db.log.find(r => r.outcome === 'sent');
    f.db.chats[chatKey(f.c)].attempt = { id: sent.attemptId, type: sent.type, deadline: f.d.now() + DEADLINE };
    const restarted = createEngine(f.d); await restarted.tick();
    assert.equal(f.c.chat.length, 1); assert.equal(f.db.log.filter(r => r.outcome === 'sent').length, 1);
});
test('tick reconciliation warns on recordDelivery failure without permanently pausing', async () => {
    const f = fixture(); await f.engine.tick();
    const a = { id: 'recovered-attempt', type: 'question', sulk: false, deadline: f.d.now() + DEADLINE };
    f.state().attempt = a;
    f.c.chat.push({ mes: 'Already delivered', extra: { ava_initiation: { attemptId: a.id } } });
    const write = f.d.write; let failed = false;
    f.d.write = db => {
        if (!failed && db.log.some(r => r.outcome === 'sent' && r.attemptId === a.id)) {
            failed = true; throw new Error('Reconcile record write failed once');
        }
        write(db);
    };
    await f.engine.tick();
    assert.equal(failed, true); assert.equal(f.engine.fatal, null);
    assert.equal(f.state().attempt, null); assert.equal(f.state().state, 'sent');
    assert.ok(f.db.log.some(r => r.outcome === 'delivery-warning' && r.attemptId === a.id
        && r.type === 'question' && r.text.includes('Reconcile record')));
    await f.engine.tick(); assert.equal(f.c.chat.length, 1);
    await f.engine.tick(true); assert.equal(f.c.chat.length, 2);
});
test('deliver catch warns on recordDelivery failure without permanently pausing', async () => {
    const f = fixture(); const write = f.d.write; let failed = false, attemptId;
    f.d.deliver = async a => {
        attemptId = a.id;
        a.c.chat.push({ mes: 'Delivered before host error', extra: { ava_initiation: { attemptId: a.id } } });
        throw new Error('Host rendering failed after publication');
    };
    f.d.write = db => {
        if (!failed && db.log.some(r => r.outcome === 'sent' && r.attemptId === attemptId)) {
            failed = true; throw new Error('Catch record write failed once');
        }
        write(db);
    };
    await f.engine.tick(true);
    assert.equal(failed, true); assert.equal(f.engine.fatal, null);
    assert.equal(f.state().attempt, null); assert.equal(f.state().state, 'sent');
    assert.ok(f.db.log.some(r => r.outcome === 'delivery-warning' && r.attemptId === attemptId
        && r.type === f.state().lastType && r.text.includes('Catch record')));
    await f.engine.tick(); assert.equal(f.c.chat.length, 1);
    await f.engine.tick(true); assert.equal(f.c.chat.length, 2);
});
test('token budget counts metadata, never silently slices source records', async () => {
    const rows = [{ outcome: 'sent', timestamp: 10, type: 'question', text: 'x'.repeat(100) }, { outcome: 'sent', timestamp: 20, type: 'one-liner', text: 'short' }];
    const history = await historyWithinTokens(rows, x => x.length, 80);
    assert.equal(JSON.parse(history).length, 1);
    await assert.rejects(historyWithinTokens(rows, () => NaN), /Invalid token/);
});
test('quiet ranges and calendar boundary handle DST using local dates', () => {
    assert.equal(quietAt(new Date(2026, 10, 6, 23, 30).getTime(), { quietStart: '23:00', quietEnd: '08:00' }), true);
    assert.equal(quietAt(new Date(2026, 10, 6, 8, 0).getTime(), { quietStart: '23:00', quietEnd: '08:00' }), false);
    const day = dayWindow(Date.now()); assert.ok(day.end > day.start);
});

test('reply while unloaded is reconciled on wake instead of sulking', async () => {
    const f = fixture(); await f.engine.tick(true);
    f.c.chat.push({ is_user: true, mes: 'Reply sent from another window' });
    f.advance(30 * MINUTE); const restarted = createEngine(f.d); await restarted.tick();
    assert.equal(f.deliveries.length, 1); assert.equal(f.state().unansweredAt, null); assert.equal(f.state().state, 'waiting');
});
test('changing interval re-arms the selected waiting chat, keeps chat isolation', async () => {
    const f = fixture(); await f.engine.tick();
    await f.engine.updateConfig({ ...f.db.config, min: 5, max: 5 });
    assert.equal(f.state().nextAt - f.d.now(), 5 * MINUTE);
    f.switch(); await f.engine.activate(); assert.equal(f.state().nextAt - f.d.now(), 5 * MINUTE);
});
test('storage failure prevents sending and surfaces a paused reason', async () => {
    const f = fixture({ write: () => { throw new Error('Storage full'); } }); await f.engine.tick(true);
    assert.equal(f.deliveries.length, 0); assert.match(f.notices.at(-1), /Storage full/); assert.ok(f.engine.fatal);
});

test('clock rollback cannot reset the daily photo cap', async () => {
    const f = fixture(); await f.engine.tick(true); await f.engine.tick(true); await f.engine.tick(true);
    assert.equal(f.db.budget.attempts, 2); f.setTime(f.db.budget.start - MINUTE);
    f.switch(); await f.engine.tick(true); assert.notEqual(f.deliveries.at(-1).type, 'photo'); assert.equal(f.db.budget.attempts, 2);
});

test('Fire now bypasses failure backoff once; timer retries still back off', async () => {
    let count = 0;
    const f = fixture({ deliver: async () => { count++; throw new Error('empty output'); } });
    await f.engine.tick(true); assert.equal(count, 1);
    assert.ok(f.state().retryAt > f.d.now());
    await f.engine.tick(); assert.equal(count, 1);
    await f.engine.tick(true); assert.equal(count, 2);
    await f.engine.tick(); assert.equal(count, 2);
    f.block(true); await f.engine.tick(true); assert.equal(count, 2);
    f.block(false); await f.engine.tick(); assert.equal(count, 3);
    await f.engine.tick(); assert.equal(count, 3);
});
