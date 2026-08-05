/**
 * IM 同步提示恢复辅助逻辑。
 * 负责解析 hint 目标、归集候选好友 uid 和配置兜底查询；不直接落库消息。
 */
import {
  getConfig,
  getFriendOnlineStatus,
} from "@/lib/tauri";
import type { ImSyncHintTarget } from "./friends-im-identity";
import { readFriendNameCache } from "./friends-local-storage";
import {
  mapResponse,
  numberField,
  stringField,
} from "./friends-response-map";
import { useLogStore } from "@/stores/app-store";
import { readChatMessages } from "./friends-storage";
import type { JsonRecord } from "./friends-status-types";

export const MAX_IM_SYNC_HINT_FRIEND_RECOVERY_SEC_UIDS = 30;
export const MAX_IM_SYNC_HINT_FRIEND_RECOVERY_USERS = 12;

export function normalizeRecoveryUid(value: unknown, currentUid = "") {
  const uid = String(value || "").trim();
  if (!/^\d{5,}$/.test(uid)) return "";
  return uid === currentUid ? "" : uid;
}

function recoveryUidFromConversationId(conversationId: string, currentUid = "") {
  const parts = String(conversationId || "").split(":");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const uid = normalizeRecoveryUid(parts[index], currentUid);
    if (uid) return uid;
  }
  return "";
}

function normalizeImSyncHintTarget(value: unknown, currentUid = ""): ImSyncHintTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  const conversationId = stringField(record, ["conversation_id", "conversationId"]).trim();
  const conversationShortId = stringField(record, ["conversation_short_id", "conversationShortId"]).trim();
  const conversationType = numberField(record, ["conversation_type", "conversationType"]) || 1;
  const senderUid = normalizeRecoveryUid(
    stringField(record, ["sender_uid", "senderUid", "uid", "from_user_id", "fromUserId"]),
    currentUid,
  ) || recoveryUidFromConversationId(conversationId, currentUid);
  const serverMessageId = stringField(record, ["server_message_id", "serverMessageId", "message_id", "messageId"]).trim();
  const indexInConversation = stringField(record, ["index_in_conversation", "indexInConversation"]).trim();
  if (!senderUid && !conversationId && !conversationShortId) return null;
  return {
    senderUid,
    conversationId,
    conversationShortId,
    conversationType,
    serverMessageId,
    indexInConversation,
  };
}

function imSyncHintPayloadObjects(value: unknown) {
  const objects: JsonRecord[] = [];
  const visit = (item: unknown, depth = 0) => {
    if (!item || depth > 2 || typeof item !== "object" || Array.isArray(item)) return;
    const record = item as JsonRecord;
    objects.push(record);
    for (const key of ["payload", "detail", "data", "event_payload", "eventPayload"]) {
      const child = record[key];
      if (child && typeof child === "object" && !Array.isArray(child)) visit(child, depth + 1);
    }
  };
  visit(value);
  return objects;
}

function imSyncHintRawTargets(record: JsonRecord) {
  const raw = record.targets ?? record.target ?? record.hint_targets ?? record.hintTargets;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {
      // 忽略格式不合法的诊断 payload。
    }
  }
  return [record];
}

export function imSyncHintTargetsFromPayload(payload: JsonRecord, currentUid = "") {
  const seen = new Set<string>();
  const targets: ImSyncHintTarget[] = [];
  for (const record of imSyncHintPayloadObjects(payload)) {
    for (const item of imSyncHintRawTargets(record)) {
      const target = normalizeImSyncHintTarget(item, currentUid);
      if (!target) continue;
      const key = imSyncHintTargetKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
  }
  return targets.slice(0, MAX_IM_SYNC_HINT_FRIEND_RECOVERY_USERS);
}

export function imSyncHintTargetKey(target: ImSyncHintTarget) {
  return [
    target.senderUid,
    target.conversationId,
    target.conversationShortId || "",
    target.serverMessageId || target.indexInConversation || "",
  ].join("|");
}

export function enqueueImSyncHintTargets(targetQueue: ImSyncHintTarget[], payload: JsonRecord, currentUid = "") {
  const targets = imSyncHintTargetsFromPayload(payload, currentUid);
  if (targets.length === 0) return;
  const merged = [...targetQueue];
  const seen = new Set(merged.map(imSyncHintTargetKey));
  for (const target of targets) {
    const key = imSyncHintTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(target);
  }
  targetQueue.splice(0, targetQueue.length, ...merged.slice(-MAX_IM_SYNC_HINT_FRIEND_RECOVERY_USERS));
  useLogStore.getState().addLog(`好友分享同步提示已收到，定向补偿目标：${targets.length} 个`, "info");
}

function addRecoveryUid(target: string[], seen: Set<string>, value: unknown, currentUid = "") {
  const uid = normalizeRecoveryUid(value, currentUid);
  if (!uid || seen.has(uid)) return;
  seen.add(uid);
  target.push(uid);
}

function cachedFriendUidsForRecovery(currentSecUid: string, currentUid = "") {
  const seen = new Set<string>();
  const uids: string[] = [];
  const cache = readFriendNameCache(currentSecUid);
  for (const uid of Object.keys(cache)) {
    addRecoveryUid(uids, seen, uid, currentUid);
  }
  try {
    const messages = readChatMessages(currentSecUid);
    for (const list of Object.values(messages)) {
      for (const message of list) {
        addRecoveryUid(uids, seen, message.senderUid, currentUid);
      }
    }
  } catch {
    // 忽略损坏的本地聊天缓存。
  }
  return uids.slice(0, MAX_IM_SYNC_HINT_FRIEND_RECOVERY_USERS);
}

export async function resolveFriendUidsForHintRecovery(currentSecUid: string, currentUid = "") {
  const seen = new Set<string>();
  const uids: string[] = [];
  for (const uid of cachedFriendUidsForRecovery(currentSecUid, currentUid)) {
    addRecoveryUid(uids, seen, uid, currentUid);
  }
  try {
    const config = await getConfig();
    const secUserIds = (config.im_friend_sec_user_ids || [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, MAX_IM_SYNC_HINT_FRIEND_RECOVERY_SEC_UIDS);
    const response = await getFriendOnlineStatus(secUserIds, [], {
      offset: 0,
      limit: secUserIds.length > 0
        ? Math.min(MAX_IM_SYNC_HINT_FRIEND_RECOVERY_SEC_UIDS, secUserIds.length)
        : MAX_IM_SYNC_HINT_FRIEND_RECOVERY_SEC_UIDS,
    });
    for (const friend of mapResponse(response)) {
      addRecoveryUid(uids, seen, friend.uid, currentUid);
      if (uids.length >= MAX_IM_SYNC_HINT_FRIEND_RECOVERY_USERS) break;
    }
  } catch {
    // 正常实时 WS 路径仍然是权威来源；这里的恢复只做尽力补偿。
  }
  return uids.slice(0, MAX_IM_SYNC_HINT_FRIEND_RECOVERY_USERS);
}
