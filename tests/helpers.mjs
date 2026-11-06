import { createEngine, initialDatabase, chatKey } from '../index.js';
function locks() {
    let busy = false, tail = Promise.resolve();
    return { async request(name, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (busy && options.ifAvailable) return callback(null);
        if (busy) await tail;
        busy = true; let release; const previous = tail; tail = new Promise(r => { release = r; });
        try { return await callback({ name }); } finally { busy = false; release(); }
    } };
}
export function fixture(overrides = {}, shared = {}) {
    let time = Date.UTC(2026, 10, 6, 12), seq = 0, block = false;
    let db = shared.db || initialDatabase({ enabled: true, allow: { A: true, B: true }, min: 1, max: 1, quietStart: '00:00', quietEnd: '00:00', creditUsd: .12 });
    let lease = null, active = { avatar: 'A', chatId: 'a', name2: 'A', chat: [] };
    const timers = new Map(), notices = [], deliveries = [], cancels = [], lock = shared.locks || locks();
    const d = { uuid: () => `id-${++seq}`, seed: () => 1, random: () => 0, now: () => time,
        locks: lock, lockName: 'profile', read: () => structuredClone(db), write: v => { db = structuredClone(v); },
        readLease: () => lease, writeLease: v => { lease = v; }, clearLease: () => { lease = null; },
        active: () => active, blocked: () => block, photoStatus: () => ({ ready: true, costUsd: .06 }),
        countTokens: async x => Math.ceil(x.length / 3), status: x => notices.push(x),
        setTimer: (fn, ms) => { const key = ++seq; timers.set(key, { fn, at: time + ms }); return key; }, clearTimer: id => timers.delete(id),
        cancel: (id, reason) => cancels.push({ id, reason }),
        deliver: async a => {
            a.guard(); if (a.type === 'photo') a.reservePhoto(.06);
            const m = { mes: a.type === 'photo' ? '' : `${a.type} hello`, extra: { ava_initiation: { attemptId: a.id } } };
            a.c.chat.push(m); a.onPublished(a.c.chat.length - 1, m); deliveries.push(a);
        }, ...overrides };
    const engine = createEngine(d);
    return { engine, d, deliveries, cancels, notices, timers,
        get db() { return db; }, set db(x) { db = x; }, get c() { return active; },
        state: () => db.chats[chatKey(active)], advance: n => { time += n; }, setTime: n => { time = n; },
        block: x => { block = x; }, switch: (avatar = 'B', chatId = 'b') => { active = { avatar, chatId, name2: avatar, chat: [] }; },
        fireTimers: () => { for (const [id, v] of [...timers]) if (v.at <= time) { timers.delete(id); v.fn(); } },
    };
}

