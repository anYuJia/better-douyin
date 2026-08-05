/**
 * IM 分享历史补偿 runtime。
 * 负责按 uid / sync-hint 目标拉取分享历史、维护 in-flight 去重和目标重排；
 * 调用方提供账号活跃判断、已见身份集合和落库回调。
 */
import { isSharedWorkPayload } from "@/lib/auto-return-shared-media";
import { getFriendMessageHistory } from "@/lib/tauri";
import { useLogStore } from "@/stores/app-store";
import {
  historyPayloadMatchesLiveNeighbor,
  historyPayloadMatchesSyncHintTarget,
  incomingHistoryIdentity,
  isFreshRecoveryShare,
  isResolvableSharedPayload,
  rememberHistoryIdentity,
  sharedPayloadText,
  type ImSyncHintTarget,
  type LiveNeighborRecoveryTarget,
} from "./friends-im-identity";
import {
  imSyncHintTargetKey,
  MAX_IM_SYNC_HINT_FRIEND_RECOVERY_USERS,
  normalizeRecoveryUid,
} from "./friends-im-recovery";
import type { JsonRecord } from "./friends-status-types";

type SharedHistoryRecoveryContext = {
  currentSecUid: string;
  currentUid: string;
  requestedEpoch: number;
  seenIdentities: Set<string>;
  inFlightKeys: Set<string>;
  isAccountActive: (requestedEpoch: number, currentSecUid: string) => boolean;
  processPayload: (payload: JsonRecord, options?: { allowAutoReturnShare?: boolean }) => void;
};

type RecoverFreshSharedHistoryForUidOptions = SharedHistoryRecoveryContext & {
  uid: string;
  reason?: string;
  liveNeighborTarget?: LiveNeighborRecoveryTarget | null;
};

type RecoverFreshSharedHistoryForTargetOptions = SharedHistoryRecoveryContext & {
  target: ImSyncHintTarget;
};

type RecoverQueuedImSyncHintTargetsOptions = SharedHistoryRecoveryContext & {
  targetQueue: ImSyncHintTarget[];
};

export async function recoverFreshSharedHistoryForUid(options: RecoverFreshSharedHistoryForUidOptions) {
  const normalizedUid = normalizeRecoveryUid(options.uid, options.currentUid);
  if (!normalizedUid || !options.isAccountActive(options.requestedEpoch, options.currentSecUid)) return 0;
  if (options.inFlightKeys.has(normalizedUid)) return 0;
  options.inFlightKeys.add(normalizedUid);
  let recovered = 0;
  try {
    const result = await getFriendMessageHistory({ cursor: 0, toUserId: normalizedUid });
    if (!options.isAccountActive(options.requestedEpoch, options.currentSecUid) || !result.success) return 0;
    const messages = Array.isArray(result.messages) ? result.messages : [];
    for (const item of messages) {
      const payload = item as unknown as JsonRecord;
      const identity = incomingHistoryIdentity(payload);
      const matchesLiveNeighbor = options.liveNeighborTarget
        ? historyPayloadMatchesLiveNeighbor(payload, options.liveNeighborTarget)
        : false;
      if (identity && options.seenIdentities.has(identity) && !matchesLiveNeighbor) continue;
      if (!isSharedWorkPayload(sharedPayloadText(payload))) continue;
      if (!matchesLiveNeighbor && !isFreshRecoveryShare(payload)) continue;
      rememberHistoryIdentity(options.seenIdentities, identity);
      options.processPayload(payload, { allowAutoReturnShare: matchesLiveNeighbor });
      recovered += 1;
    }
    if (recovered > 0) {
      useLogStore.getState().addLog(
        options.reason === "live_neighbor"
          ? `好友分享内容已通过实时消息邻近补偿同步：${recovered} 条`
          : `好友分享内容已通过历史补偿同步：${recovered} 条`,
        "info",
      );
    }
    return recovered;
  } catch {
    return 0;
  } finally {
    options.inFlightKeys.delete(normalizedUid);
  }
}

export async function recoverFreshSharedHistoryForTarget(options: RecoverFreshSharedHistoryForTargetOptions) {
  const normalizedUid = normalizeRecoveryUid(options.target.senderUid, options.currentUid);
  const canUseConversation = Boolean(options.target.conversationId);
  if (!options.isAccountActive(options.requestedEpoch, options.currentSecUid)) return 0;
  if (!normalizedUid && !canUseConversation) return 0;
  const inFlightKey = canUseConversation
    ? `conversation:${options.target.conversationId}`
    : `uid:${normalizedUid}`;
  if (options.inFlightKeys.has(inFlightKey)) return 0;
  options.inFlightKeys.add(inFlightKey);
  let recovered = 0;
  try {
    const result = await getFriendMessageHistory(
      canUseConversation
        ? {
            cursor: 0,
            conversationId: options.target.conversationId,
            conversationShortId: options.target.conversationShortId || undefined,
            conversationType: options.target.conversationType || 1,
          }
        : { cursor: 0, toUserId: normalizedUid },
    );
    if (!options.isAccountActive(options.requestedEpoch, options.currentSecUid)) return 0;
    if (!result.success) {
      return canUseConversation && normalizedUid
        ? recoverFreshSharedHistoryForUid({ ...options, uid: normalizedUid, reason: "sync_hint" })
        : 0;
    }
    const messages = Array.isArray(result.messages) ? result.messages : [];
    for (const item of messages) {
      const payload = item as unknown as JsonRecord;
      const identity = incomingHistoryIdentity(payload);
      if (!historyPayloadMatchesSyncHintTarget(payload, options.target)) continue;
      if (!isSharedWorkPayload(sharedPayloadText(payload))) continue;
      if (identity && options.seenIdentities.has(identity) && !isResolvableSharedPayload(payload)) continue;
      rememberHistoryIdentity(options.seenIdentities, identity);
      options.processPayload(payload, { allowAutoReturnShare: true });
      recovered += 1;
    }
    if (recovered > 0) {
      useLogStore.getState().addLog(`好友分享内容已通过定向历史补偿同步：${recovered} 条`, "info");
    }
    if (recovered === 0 && canUseConversation && normalizedUid) {
      return recoverFreshSharedHistoryForUid({ ...options, uid: normalizedUid, reason: "sync_hint" });
    }
    return recovered;
  } catch {
    return canUseConversation && normalizedUid
      ? recoverFreshSharedHistoryForUid({ ...options, uid: normalizedUid, reason: "sync_hint" })
      : 0;
  } finally {
    options.inFlightKeys.delete(inFlightKey);
  }
}

export function requeueImSyncHintTargets(targetQueue: ImSyncHintTarget[], targets: ImSyncHintTarget[]) {
  if (targets.length === 0) return;
  const merged = [...targets, ...targetQueue];
  const seen = new Set<string>();
  const unique: ImSyncHintTarget[] = [];
  for (const target of merged) {
    const key = imSyncHintTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  targetQueue.splice(0, targetQueue.length, ...unique.slice(-MAX_IM_SYNC_HINT_FRIEND_RECOVERY_USERS));
}

export async function recoverQueuedImSyncHintTargets(options: RecoverQueuedImSyncHintTargetsOptions) {
  const pendingTargets = options.targetQueue.splice(0);
  if (pendingTargets.length === 0) return 0;
  let recovered = 0;
  for (const target of pendingTargets) {
    if (!options.isAccountActive(options.requestedEpoch, options.currentSecUid)) {
      requeueImSyncHintTargets(options.targetQueue, pendingTargets);
      return recovered;
    }
    recovered += await recoverFreshSharedHistoryForTarget({ ...options, target });
  }
  if (recovered === 0) {
    // 同步提示可能比历史接口暴露卡片早一点到达。
    // 保留精确目标给基线完成后的重试使用，不要只退化成无目标的全局拉取。
    requeueImSyncHintTargets(options.targetQueue, pendingTargets);
  }
  return recovered;
}
