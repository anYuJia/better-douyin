/**
 * IM 入站身份与匹配规则。
 * 只做 payload 身份解析、时间可信判断、历史/同步提示匹配和自发回声去重；
 * 不读写持久化状态，也不触发网络发送。
 */
import {
  isResolvableSharedWorkPayload,
  isSharedWorkPayload,
} from "@/lib/auto-return-shared-media";
import { fallbackMessageText } from "./friends-message-format";
import { unknownFriendKey } from "./friends-local-storage";
import { numberField, stringField } from "./friends-response-map";
import type { JsonRecord } from "./friends-status-types";

export const RECENT_AUTO_REPLY_TTL_MS = 5 * 60_000;
export const RECENT_AUTO_RETURN_ECHO_TTL_MS = 10 * 60_000;
export const MAX_IM_HISTORY_IDENTITIES = 4_096;
export const IM_LIVE_NEIGHBOR_RECOVERY_INDEX_WINDOW = 8;
// 203 `messages_per_user_init` 既可能是首次连接同步，也可能是短线重连补偿。
// 只有服务端提供了可信的新鲜时间戳时，历史补偿才允许返回分享内容；
// AI 文本回复仍然只能由实时消息触发，避免旧历史被意外自动回复。
export const RECOVERY_SHARE_AUTOMATION_WINDOW_MS = 2 * 60_000;
export const RECOVERY_SERVER_TIME_FUTURE_SKEW_MS = 60_000;

export type MessageDirection = {
  /** 传输层是否明确给出了入站/出站方向。 */
  explicit: boolean;
  outgoing: boolean;
};

export type ImSyncHintTarget = {
  senderUid: string;
  conversationId: string;
  conversationShortId: string;
  conversationType: number;
  serverMessageId: string;
  indexInConversation: string;
};

export type LiveNeighborRecoveryTarget = {
  senderUid: string;
  conversationId: string;
  conversationShortId: string;
  indexInConversation: string;
  allowExactIndex: boolean;
};

/**
 * 本地聊天消息 ID 必须带上会话命名空间。
 * 富分享卡片缺少服务端消息 ID 时会使用 `index_in_conversation`，
 * 但这个 index 只在单个会话内唯一，不能跨好友全局去重。
 */
export function buildIncomingMessageStorageId(
  conversationNamespace: string,
  serverMessageId: string,
  createdAt: number,
) {
  const namespace = conversationNamespace.trim() || "unknown-conversation";
  const stableId = serverMessageId.trim();
  return stableId
    ? `${namespace}:message:${stableId}`
    : `${namespace}:received:${createdAt}`;
}

export function incomingConversationNamespace(payload: JsonRecord, fallbackConversationKey: string) {
  const conversationId = stringField(payload, ["conversation_id", "conversationId"]).trim();
  if (conversationId) return `conversation:${conversationId}`;
  const conversationShortId = stringField(payload, ["conversation_short_id", "conversationShortId"]).trim();
  if (conversationShortId) return `conversation-short:${conversationShortId}`;
  return fallbackConversationKey;
}

/**
 * 当富 IM 卡片缺少标准服务端消息 ID 时，`index_in_conversation` 是稳定兜底值。
 * 它只在会话内唯一，所以调用方必须结合上面的会话命名空间使用。
 */
export function incomingStableMessageId(payload: JsonRecord) {
  const candidates = [
    stringField(payload, ["server_message_id", "serverMessageId"]),
    stringField(payload, ["index_in_conversation", "indexInConversation"]),
    stringField(payload, ["message_id", "messageId", "id"]),
    stringField(payload, ["client_message_id", "clientMessageId"]),
  ];
  return candidates.find((value) => {
    const normalized = value.trim();
    return Boolean(normalized && normalized !== "0");
  })?.trim() || "";
}

/**
 * 历史消息偶尔会缺少所有传输层 ID。
 * 这个兜底身份只保存在内存中，用来比较相邻两次历史拉取；
 * 它刻意包含会话和发送者，避免不同好友的相同卡片文案误判为同一条分享。
 */
export function incomingHistoryIdentity(payload: JsonRecord) {
  const senderUid = stringField(payload, ["sender_uid", "senderUid"]);
  const fallbackConversationKey = senderUid ? unknownFriendKey(senderUid) : "unknown-conversation";
  const namespace = incomingConversationNamespace(payload, fallbackConversationKey);
  const stableId = incomingStableMessageId(payload);
  if (stableId) return buildIncomingMessageStorageId(namespace, stableId, 0);
  const rawCreatedAt = numberField(payload, [
    "server_created_at",
    "serverCreatedAt",
    "created_at",
    "createdAt",
    "create_time",
    "createTime",
  ]);
  const createdAt = normalizeTimestampMillis(rawCreatedAt);
  const content = stringField(payload, ["raw_content", "rawContent", "content", "text"])
    .trim()
    .slice(0, 1_024);
  return `${namespace}:history:${senderUid}:${createdAt}:${content}`;
}

export function rememberHistoryIdentity(identities: Set<string>, identity: string) {
  if (!identity) return;
  identities.add(identity);
  while (identities.size > MAX_IM_HISTORY_IDENTITIES) {
    const oldest = identities.values().next().value as string | undefined;
    if (oldest === undefined) break;
    identities.delete(oldest);
  }
}

export function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "out", "outgoing"].includes(normalized)) return true;
    if (["0", "false", "no", "in", "incoming"].includes(normalized)) return false;
  }
  return undefined;
}

export function normalizeTimestampMillis(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 10_000_000_000 ? value * 1000 : value;
}

export function isInitialSyncPayload(payload: JsonRecord) {
  if (booleanValue(payload.is_initial_sync ?? payload.isInitialSync) === true) return true;
  return stringField(payload, ["source", "event_source", "eventSource"]).trim().toLowerCase() === "initial_sync";
}

export function trustedServerTimestampMs(payload: JsonRecord) {
  // `created_at` 不能参与补偿安全判断：适配层可能把它填成本地接收时间。
  // 只有显式的服务端时间字段才适合驱动后台补偿副作用。
  if (booleanValue(payload.has_server_created_at ?? payload.hasServerCreatedAt) !== true) return 0;
  return normalizeTimestampMillis(numberField(payload, ["server_created_at", "serverCreatedAt"]));
}

export function hasTrustedRecentServerTimestamp(payload: JsonRecord, cutoff: number, now = Date.now()) {
  const createdAt = trustedServerTimestampMs(payload);
  return createdAt > 0
    && createdAt >= cutoff
    && createdAt <= now + RECOVERY_SERVER_TIME_FUTURE_SKEW_MS;
}

export function isFreshRecoveryShare(payload: JsonRecord, now = Date.now()) {
  return hasTrustedRecentServerTimestamp(
    payload,
    Math.max(0, now - RECOVERY_SHARE_AUTOMATION_WINDOW_MS),
    now,
  );
}

export function isFreshSharedRecoveryPayload(payload: JsonRecord) {
  const rawContent = stringField(payload, ["raw_content", "rawContent"]) || undefined;
  const text = stringField(payload, ["content", "text"]) || fallbackMessageText(rawContent);
  return isSharedWorkPayload(rawContent || text) && isFreshRecoveryShare(payload);
}

export function sharedPayloadText(payload: JsonRecord) {
  const rawContent = stringField(payload, ["raw_content", "rawContent"]) || undefined;
  const text = stringField(payload, ["content", "text"]) || fallbackMessageText(rawContent);
  return rawContent || text;
}

export function isResolvableSharedPayload(payload: JsonRecord) {
  return isResolvableSharedWorkPayload(sharedPayloadText(payload));
}

export function imIndexBigInt(value: unknown) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text) || text === "0") return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

export function liveNeighborRecoveryTargetFromPayload(payload: JsonRecord): LiveNeighborRecoveryTarget | null {
  const senderUid = stringField(payload, ["sender_uid", "senderUid"]).trim();
  const conversationId = stringField(payload, ["conversation_id", "conversationId"]).trim();
  const conversationShortId = stringField(payload, ["conversation_short_id", "conversationShortId"]).trim();
  const indexInConversation = stringField(payload, ["index_in_conversation", "indexInConversation"]).trim();
  const rawContent = stringField(payload, ["raw_content", "rawContent"]).trim();
  if (!senderUid || !indexInConversation || (!conversationId && !conversationShortId)) return null;
  return {
    senderUid,
    conversationId,
    conversationShortId,
    indexInConversation,
    allowExactIndex: !rawContent || !isSharedWorkPayload(rawContent),
  };
}

export function historyPayloadMatchesLiveNeighbor(payload: JsonRecord, target: LiveNeighborRecoveryTarget) {
  const payloadSenderUid = stringField(payload, ["sender_uid", "senderUid"]).trim();
  if (target.senderUid && payloadSenderUid && target.senderUid !== payloadSenderUid) return false;

  let matchedConversation = false;
  const payloadConversationId = stringField(payload, ["conversation_id", "conversationId"]).trim();
  if (target.conversationId && payloadConversationId) {
    if (target.conversationId !== payloadConversationId) return false;
    matchedConversation = true;
  }

  const payloadShortId = stringField(payload, ["conversation_short_id", "conversationShortId"]).trim();
  if (target.conversationShortId && payloadShortId && payloadShortId !== "0") {
    if (target.conversationShortId !== payloadShortId) return false;
    matchedConversation = true;
  }
  if (!matchedConversation) return false;

  const payloadIndex = imIndexBigInt(stringField(payload, ["index_in_conversation", "indexInConversation"]));
  const targetIndex = imIndexBigInt(target.indexInConversation);
  if (payloadIndex === null || targetIndex === null) return false;
  if (payloadIndex === targetIndex) return target.allowExactIndex || isResolvableSharedPayload(payload);
  const distance = payloadIndex > targetIndex ? payloadIndex - targetIndex : targetIndex - payloadIndex;
  return distance <= BigInt(IM_LIVE_NEIGHBOR_RECOVERY_INDEX_WINDOW);
}

export function imSyncHintTargetIdentity(target: ImSyncHintTarget) {
  const fallbackConversationKey = target.senderUid ? unknownFriendKey(target.senderUid) : "unknown-conversation";
  const namespace = target.conversationId
    ? `conversation:${target.conversationId}`
    : target.conversationShortId
      ? `conversation-short:${target.conversationShortId}`
      : fallbackConversationKey;
  const stableId = String(target.serverMessageId || target.indexInConversation || "").trim();
  return stableId ? buildIncomingMessageStorageId(namespace, stableId, 0) : "";
}

export function historyPayloadMatchesSyncHintTarget(payload: JsonRecord, target: ImSyncHintTarget) {
  const targetIdentity = imSyncHintTargetIdentity(target);
  if (targetIdentity && incomingHistoryIdentity(payload) === targetIdentity) return true;

  let matchedTransport = false;
  const payloadConversationId = stringField(payload, ["conversation_id", "conversationId"]).trim();
  if (target.conversationId && payloadConversationId) {
    if (target.conversationId !== payloadConversationId) return false;
    matchedTransport = true;
  }

  const payloadShortId = stringField(payload, ["conversation_short_id", "conversationShortId"]).trim();
  if (target.conversationShortId && payloadShortId && payloadShortId !== "0") {
    if (target.conversationShortId !== payloadShortId) return false;
    matchedTransport = true;
  }

  const senderUid = stringField(payload, ["sender_uid", "senderUid"]);
  if (target.senderUid && senderUid) {
    if (target.senderUid !== senderUid) return false;
    matchedTransport = true;
  }

  // 同步提示本身就是这个会话/发送者的实时信号。
  // 部分从历史中补回的抖音富图集行没有 has_server_created_at，
  // 这里强制要求新鲜时间戳会把提示想找回的那张卡片静默丢掉。
  return matchedTransport || isFreshSharedRecoveryPayload(payload);
}

export function resolveMessageDirection(payload: JsonRecord, currentUid: string): MessageDirection {
  const direction = stringField(payload, ["direction"]).trim().toLowerCase();
  if (["out", "outgoing"].includes(direction)) return { explicit: true, outgoing: true };
  if (["in", "incoming"].includes(direction)) return { explicit: true, outgoing: false };

  for (const key of ["is_outgoing", "isOutgoing", "from_self", "fromSelf"]) {
    const resolved = booleanValue(payload[key]);
    if (resolved !== undefined) return { explicit: true, outgoing: resolved };
  }

  const senderUid = stringField(payload, ["sender_uid", "senderUid"]);
  if (senderUid && currentUid) {
    // 这足以压住自己的发送回声，但它不是明确的入站标记，
    // 不能让历史补偿消息具备自动化触发资格。
    return { explicit: false, outgoing: senderUid === currentUid };
  }
  return { explicit: false, outgoing: false };
}

export function normalizedOutgoingText(text: string) {
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, 500);
}

export function pruneRecentOutgoingText(recentOutgoingTexts: Map<string, number>, now = Date.now()) {
  for (const [key, expiresAt] of recentOutgoingTexts) {
    if (expiresAt <= now) recentOutgoingTexts.delete(key);
  }
}

export function rememberRecentOutgoingText(recentOutgoingTexts: Map<string, number>, text: string) {
  const key = normalizedOutgoingText(text);
  if (!key) return;
  pruneRecentOutgoingText(recentOutgoingTexts);
  recentOutgoingTexts.set(key, Date.now() + RECENT_AUTO_REPLY_TTL_MS);
}

export function wasRecentlyAutoSent(recentOutgoingTexts: Map<string, number>, text: string) {
  const key = normalizedOutgoingText(text);
  if (!key) return false;
  pruneRecentOutgoingText(recentOutgoingTexts);
  return recentOutgoingTexts.has(key);
}

export function pruneRecentAutoReturnMessageKeys(recentMessageKeys: Map<string, number>, now = Date.now()) {
  for (const [key, expiresAt] of recentMessageKeys) {
    if (expiresAt <= now) recentMessageKeys.delete(key);
  }
}

export function rememberRecentAutoReturnMessageKeys(recentMessageKeys: Map<string, number>, keys: string[] = []) {
  pruneRecentAutoReturnMessageKeys(recentMessageKeys);
  const expiresAt = Date.now() + RECENT_AUTO_RETURN_ECHO_TTL_MS;
  for (const key of keys) {
    const normalized = String(key || "").trim();
    if (normalized) recentMessageKeys.set(normalized, expiresAt);
  }
}

export function autoReturnEchoKeysFromPayload(payload: JsonRecord) {
  const keys: string[] = [];
  const clientMessageId = stringField(payload, ["client_message_id", "clientMessageId"]).trim();
  if (clientMessageId) keys.push(`client:${clientMessageId}`);
  for (const key of ["server_message_id", "serverMessageId", "message_id", "messageId", "id"]) {
    const messageId = stringField(payload, [key]).trim();
    if (messageId && messageId !== "0") keys.push(`server:${messageId}`);
  }
  return keys;
}

export function wasRecentlyAutoReturnedMessage(recentMessageKeys: Map<string, number>, payload: JsonRecord) {
  pruneRecentAutoReturnMessageKeys(recentMessageKeys);
  return autoReturnEchoKeysFromPayload(payload).some((key) => recentMessageKeys.has(key));
}
