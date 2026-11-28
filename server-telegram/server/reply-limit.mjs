import {hash} from './core.mjs';

export const UNANSWERED_LIMIT = 4;
const users = rows => rows.filter(m => m.is_user && !m.is_system && typeof m.mes === 'string');
const keys = rows => users(rows).map(m => hash([m.send_date ?? null, m.mes]));
const timestamp = value => typeof value === 'number' ? value : Date.parse(value);

// Seed from original receipt creation times, not import times. Importing old
// messages after a reply must not make those messages unanswered again.
export function seedReplyLimit(bindings) {
    const dates = bindings.flatMap(({rows}) => users(rows).map(m => timestamp(m.send_date))).filter(Number.isFinite);
    const lastReplyAt = dates.length ? Math.max(...dates) : null;
    const receipts = new Map();
    const known = new Set(bindings.flatMap(({target}) => [...target.archive || [], ...target.queue || []].map(p => p.id)));
    let uncertain = false;
    for (const {target, rows} of bindings) {
        const lastUserIndex = rows.findLastIndex(m => m.is_user && !m.is_system);
        const positions = new Map(rows.map((m, i) => [m.extra?.server_initiation?.id, i]));
        for (const p of [...target.archive || [], ...target.queue || []]) {
            if (!p.id) continue;
            if (lastReplyAt !== null && Number.isFinite(p.createdAt)) {
                if (p.createdAt > lastReplyAt) receipts.set(p.id, true);
            } else if (positions.has(p.id)) {
                if (positions.get(p.id) > lastUserIndex) receipts.set(p.id, true);
            } else uncertain = true;
        }
        for (const [i, m] of rows.entries()) {
            const p = m.extra?.server_initiation;
            if (!p?.id || known.has(p.id)) continue;
            const createdAt = timestamp(p.createdAt ?? m.send_date);
            if (lastReplyAt !== null && Number.isFinite(createdAt)) {
                if (createdAt > lastReplyAt) receipts.set(p.id, true);
            } else if (i > lastUserIndex) receipts.set(p.id, true);
        }
    }
    return {count: uncertain ? UNANSWERED_LIMIT : Math.min(UNANSWERED_LIMIT, receipts.size),
        observedUsers: Object.fromEntries(bindings.map(({target, rows}) => [target.chatId, keys(rows)]))};
}

// One durable gate per companion, shared by every chat binding. Refresh, import,
// pause, re-enable, and moving to another chat cannot grant a fresh allowance.
export function observeReply(limit, chatId, rows) {
    const next = keys(rows), previous = limit.observedUsers[chatId];
    const replied = !!previous && next.length > previous.length && previous.every((key, i) => key === next[i]);
    if (replied) limit.count = 0;
    limit.observedUsers[chatId] = next;
    return replied;
}

export function reserveInitiation(limit) {
    if (limit.count >= UNANSWERED_LIMIT) throw new Error('Waiting for your reply after four initiations.');
    limit.count++;
}
