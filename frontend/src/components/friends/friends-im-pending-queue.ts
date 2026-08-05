/**
 * IM 入站消息短暂排队队列。
 * 只负责账号尚未确定时的内存排队、重复身份去重和溢出时间记录；
 * 不判断账号是否可用，也不处理消息落库。
 */
import { incomingHistoryIdentity } from "./friends-im-identity";
import type { JsonRecord } from "./friends-status-types";

export const MAX_PENDING_IM_EVENTS = 64;

export type ImIncomingPayloadSource = "live" | "initial_sync" | "history" | "watchdog" | "hint";

export type PendingIncomingPayload = {
  payload: JsonRecord;
  accountEpoch: number;
  receivedAt: number;
  source: ImIncomingPayloadSource;
};

export function enqueuePendingIncomingPayload(
  pending: PendingIncomingPayload[],
  payload: JsonRecord,
  accountEpoch: number,
  source: ImIncomingPayloadSource,
  currentOverflowAt: number,
  now = Date.now(),
) {
  const pendingIdentity = incomingHistoryIdentity(payload);
  if (pendingIdentity && pending.some((item) => incomingHistoryIdentity(item.payload) === pendingIdentity)) {
    return currentOverflowAt;
  }

  pending.push({ payload, accountEpoch, receivedAt: now, source });
  if (pending.length <= MAX_PENDING_IM_EVENTS) return currentOverflowAt;

  const removed = pending.splice(0, pending.length - MAX_PENDING_IM_EVENTS);
  const oldestRemoved = removed[0]?.receivedAt || now;
  return currentOverflowAt
    ? Math.min(currentOverflowAt, oldestRemoved)
    : oldestRemoved;
}

export function drainPendingIncomingPayloads(pending: PendingIncomingPayload[]) {
  return pending.splice(0);
}
