import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimedDiagnostic, createSingleDiagnostic, MINUTE } from '../index.js';

function fixture(extra = {}, storage = {}) {
    let now = 1000, id = 0, active = { avatar: 'A', chatId: 'chat-a', chat: [] }, blocked = '', interrupted = false;
    const timers = new Map(), rows = [], statuses = [], calls = { run: 0, cancel: 0, locks: 0, writes: 0 };
    const d = { now: () => now, uuid: () => `timer-${++id}`, active: () => active,
        blocked: () => blocked, interrupted: () => interrupted,
        locks: { request: async (_name, _opts, fn) => { calls.locks++; return fn({}); } }, lockName: 'profile',
        readArm: () => storage.arm, writeArm: value => { calls.writes++; storage.arm = value; },
        setTimer: (fn, ms) => { const key = ++id; timers.set(key, { fn, ms }); return key; }, clearTimer: key => timers.delete(key),
        trace: row => rows.push(row), status: text => statuses.push(text),
        run: async expected => { expected.guard(); calls.run++; }, cancelRun: () => { calls.cancel++; }, ...extra };
    return { d, timed: createTimedDiagnostic(d), storage, timers, rows, statuses, calls,
        advance: ms => { now += ms; }, block: reason => { blocked = reason; }, interrupt: () => { interrupted = true; },
        switchChat: () => { active = { ...active, chatId: 'chat-b', chat: [] }; },
        fire: async () => { const [key, timer] = timers.entries().next().value; timers.delete(key); await timer.fn(); } };
}

test('one explicit arm schedules 60 seconds; double taps and reload never schedule a second run', async () => {
    const f = fixture();
    assert.equal(f.calls.locks, 0); assert.equal(f.timers.size, 0); assert.equal(f.calls.writes, 0);
    await Promise.all([f.timed.arm(), f.timed.arm()]);
    assert.equal(f.calls.writes, 1); assert.equal(f.timers.size, 1); assert.equal(f.calls.run, 0);
    assert.equal([...f.timers.values()][0].ms, MINUTE);
    f.advance(MINUTE); await f.fire();
    assert.equal(f.calls.run, 1); assert.equal(f.timed.busy, false); assert.equal(f.timers.size, 0);
    assert.deepEqual(f.rows.map(r => r.event), ['timer-armed', 'timer-fired', 'timer-finished']);
    assert.ok(f.rows.every(r => r.attemptId === f.storage.arm.id && r.retry === 0));
    await f.timed.arm(); assert.equal(f.timers.size, 0);
    const reloaded = fixture({}, f.storage); await reloaded.timed.arm();
    assert.equal(reloaded.timers.size, 0); assert.equal(reloaded.calls.run, 0);
});

test('cancel clears the timer and even a stale callback cannot generate or rearm', async () => {
    const f = fixture(); await f.timed.arm(); const callback = [...f.timers.values()][0].fn;
    f.timed.cancel('App backgrounded.'); f.advance(MINUTE); await callback(); await f.timed.arm();
    assert.equal(f.calls.run, 0); assert.equal(f.timers.size, 0); assert.equal(f.timed.used, true);
    assert.ok(f.rows.some(r => r.event === 'timer-cancelled' && /backgrounded/.test(r.detail)));
});

test('chat change, hidden/composer state, busy generation and a late timer fail closed without retries', async () => {
    for (const change of [f => f.switchChat(), f => f.interrupt(), f => f.block('Reply busy'), f => f.advance(15001)]) {
        const f = fixture(); await f.timed.arm(); f.advance(MINUTE); change(f); await f.fire();
        assert.equal(f.calls.run, 0); assert.equal(f.timers.size, 0); assert.equal(f.timed.used, true);
        assert.ok(f.rows.some(r => r.event === 'timer-cancelled'));
        await f.timed.arm(); assert.equal(f.timers.size, 0);
    }
});

test('storage failure, occupied profile lock and an arm claimed by another tab send nothing', async () => {
    const failed = fixture({ writeArm: () => { throw new Error('Storage full'); } }); await failed.timed.arm();
    assert.equal(failed.timers.size, 0); assert.equal(failed.calls.run, 0);
    assert.match(failed.rows.at(-1).detail, /Storage full/);
    const locked = fixture({ locks: { request: async (_n, _o, fn) => fn(null) } }); await locked.timed.arm();
    assert.equal(locked.timers.size, 0); assert.equal(locked.calls.writes, 0);
    const storage = {}, other = fixture({ locks: { request: async (_n, _o, fn) => { storage.arm = {}; return fn({}); } } }, storage);
    await other.timed.arm(); assert.equal(other.timers.size, 0); assert.equal(other.calls.writes, 0);
});

test('cancellation or chat change while awaiting the arm lock cannot schedule work', async () => {
    for (const cancel of [f => f.timed.cancel('Stopped'), f => f.switchChat()]) {
        let grant;
        const f = fixture({ locks: { request: (_n, _o, fn) => new Promise(resolve => { grant = () => resolve(Promise.resolve().then(() => fn({}))); }) } });
        const work = f.timed.arm(); cancel(f); grant(); await work;
        assert.equal(f.timers.size, 0); assert.equal(f.calls.writes, 0);
    }
});

test('a failed delivery is logged once without another timer or model call', async () => {
    const f = fixture({ run: async () => { throw new TypeError('Failed to fetch'); } });
    await f.timed.arm(); f.advance(MINUTE); await f.fire();
    assert.equal(f.timed.busy, false); assert.equal(f.timers.size, 0);
    assert.match(f.rows.find(r => r.event === 'timer-cancelled').detail, /TypeError.*Failed to fetch/);
    await f.timed.arm(); assert.equal(f.timers.size, 0);
});

test('real single runner preserves timer ID and permits its own generation and publication', async () => {
    const f = fixture(); let reservation, generated = 0, published = 0;
    const single = createSingleDiagnostic({ ...f.d, readUsed: () => reservation, writeUsed: x => { reservation = x; },
        execute: async job => { generated++; f.block('Own generation busy'); job.guard(); return 'New text'; },
        publish: async job => { job.guard(); published++; },
    });
    f.d.run = expected => single.run(expected); f.d.cancelRun = reason => single.cancel(reason);
    await f.timed.arm(); f.advance(MINUTE); await f.fire();
    assert.equal(generated, 1); assert.equal(published, 1); assert.equal(reservation.id, f.storage.arm.id);
    assert.ok(f.rows.some(r => r.event === 'single-success')); assert.equal(f.timers.size, 0);
});

test('cancel between timer firing and single-run lock prevents dispatch', async () => {
    const f = fixture(); let grant, generated = 0, reservation;
    const single = createSingleDiagnostic({ ...f.d, readUsed: () => reservation, writeUsed: x => { reservation = x; },
        locks: { request: (_n, _o, fn) => new Promise(resolve => { grant = () => resolve(Promise.resolve().then(() => fn({}))); }) },
        execute: async () => { generated++; return 'Must not run'; },
    });
    f.d.run = expected => single.run(expected); f.d.cancelRun = reason => single.cancel(reason);
    await f.timed.arm(); f.advance(MINUTE); const work = f.fire();
    f.timed.cancel('Chat changed.'); grant(); await work;
    assert.equal(generated, 0); assert.equal(reservation, undefined); assert.equal(f.timed.busy, false);
});
