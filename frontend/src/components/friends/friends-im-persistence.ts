/**
 * 入站 IM 消息落库入口。
 * 调用方负责判断消息来源是否安全；本模块只写聊天消息、会话摘要、未读数和会话缓存。
 */
import { isSharedWorkPayload } from "@/lib/auto-return-shared-media";
import { saveFriendChatState } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";
import {
  persistChatSessions,
  readChatSessions,
  refreshChatSession,
} from "./friends-chat-session";
import { emitFriendChatUpdated } from "./friends-im-events";
import {
  booleanValue,
  buildIncomingMessageStorageId,
  incomingConversationNamespace,
  incomingStableMessageId,
} from "./friends-im-identity";
import {
  readCachedFriendDisplayName,
  unknownFriendKey,
} from "./friends-local-storage";
import { fallbackMessageText } from "./friends-message-format";
import {
  numberField,
  stringField,
} from "./friends-response-map";
import {
  persistChatMessages,
  persistChatSummaries,
  persistUnreadCounts,
  readChatMessages,
  readChatSummaries,
  readUnreadCounts,
} from "./friends-storage";
import type {
  ChatMessages,
  ChatSession,
  ChatSummaries,
  JsonRecord,
  LocalChatMessage,
  UnreadCounts,
} from "./friends-status-types";

export type IncomingMessagePersistenceResult = {
  conversationKey: string;
  senderUid: string;
  message: LocalChatMessage;
  nextMessages: ChatMessages;
  session: ChatSession;
  upgradedExisting: boolean;
};

function unreadTotal(unreadCounts: UnreadCounts) {
  return Object.values(unreadCounts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function findExistingMessageIndex(
  messages: ChatMessages,
  conversationKey: string,
  message: LocalChatMessage,
  hasStableServerMessageId: boolean,
  legacyServerMessageId: string,
) {
  return (messages[conversationKey] || []).findIndex((item) =>
    item.id === message.id ||
    // 兼容旧版本已落库的消息：旧版本只存裸 server/index ID。
    // 兼容范围刻意限制在当前会话内，避免另一个好友的相同 index 吞掉新的分享卡片。
    (hasStableServerMessageId && Boolean(legacyServerMessageId) && item.id === legacyServerMessageId) ||
    (
      !hasStableServerMessageId &&
      Boolean(message.text) &&
      item.senderUid === message.senderUid &&
      item.text === message.text &&
      Math.abs(item.createdAt - message.createdAt) < 60_000
    )
  );
}

function sharedPayloadRichness(message: LocalChatMessage) {
  const rawContent = String(message.rawContent || "").trim();
  if (!rawContent || rawContent === "[图集]" || rawContent === "[分享作品]") return 0;
  return isSharedWorkPayload(rawContent) ? 2 : 1;
}

function shouldUpgradeSharedPlaceholder(existing: LocalChatMessage, incoming: LocalChatMessage) {
  return sharedPayloadRichness(incoming) > sharedPayloadRichness(existing);
}

export function persistIncomingMessage(
  currentSecUid: string,
  payload: JsonRecord,
): IncomingMessagePersistenceResult | null {
  const senderUid = stringField(payload, ["sender_uid", "senderUid"]);
  const rawContent = stringField(payload, ["raw_content", "rawContent"]) || undefined;
  const text = stringField(payload, ["content", "text"]) || fallbackMessageText(rawContent);
  if (!senderUid || !text) return null;

  const conversationKey = unknownFriendKey(senderUid);
  // 监听器会把 `created_at` 保留为本地接收时间。
  // 批量 203 记录排序时优先使用明确可信的服务端时间；
  // 否则沿用接收/历史时间作为安全兜底。
  const hasServerCreatedAt = booleanValue(payload.has_server_created_at ?? payload.hasServerCreatedAt) === true;
  const rawServerCreatedAt = hasServerCreatedAt
    ? numberField(payload, ["server_created_at", "serverCreatedAt"])
    : 0;
  const rawCreatedAt = rawServerCreatedAt || numberField(payload, ["created_at", "createdAt", "create_time", "createTime"]);
  const createdAt = rawCreatedAt > 0 && rawCreatedAt < 10_000_000_000
    ? rawCreatedAt * 1000
    : rawCreatedAt || Date.now();
  const serverMessageId = incomingStableMessageId(payload);
  const messageNamespace = incomingConversationNamespace(payload, conversationKey);
  const message: LocalChatMessage = {
    id: buildIncomingMessageStorageId(messageNamespace, serverMessageId, createdAt),
    text,
    rawContent,
    createdAt,
    status: "sent",
    direction: "in",
    senderUid,
  };

  const chatMessages = readChatMessages(currentSecUid);
  const conversationMessages = chatMessages[conversationKey] || [];
  // 不要仅因两张分享卡片都使用相同的简短展示文案（例如“[分享作品]”）
  // 就合并两条不同的服务端消息。文本/时间匹配只用于缺少稳定服务端 ID 的旧记录兜底。
  const existingIndex = findExistingMessageIndex(
    chatMessages,
    conversationKey,
    message,
    Boolean(serverMessageId),
    serverMessageId,
  );
  if (existingIndex >= 0) {
    const existing = conversationMessages[existingIndex];
    if (!shouldUpgradeSharedPlaceholder(existing, message)) return null;

    const upgradedMessage: LocalChatMessage = {
      ...existing,
      text: message.text || existing.text,
      rawContent: message.rawContent || existing.rawContent,
      senderUid: message.senderUid || existing.senderUid,
    };
    const upgradedConversation = [...conversationMessages];
    upgradedConversation[existingIndex] = upgradedMessage;
    upgradedConversation.sort((a, b) => a.createdAt - b.createdAt);
    const nextMessages: ChatMessages = {
      ...chatMessages,
      [conversationKey]: upgradedConversation,
    };
    const chatSummaries = readChatSummaries(currentSecUid);
    const currentSummary = chatSummaries[conversationKey];
    const nextSummaries: ChatSummaries = currentSummary
      ? {
          ...chatSummaries,
          [conversationKey]: {
            ...currentSummary,
            latestMessage: currentSummary.latestMessage?.id === existing.id
              ? upgradedMessage
              : currentSummary.latestMessage,
          },
        }
      : chatSummaries;
    const unreadCounts = readUnreadCounts(currentSecUid);

    persistChatMessages(nextMessages, currentSecUid);
    const chatSessions = readChatSessions(currentSecUid);
    const displayName = readCachedFriendDisplayName(currentSecUid, senderUid);
    const session = refreshChatSession(
      chatSessions[conversationKey],
      nextMessages[conversationKey] || [],
      displayName,
      true,
    );
    persistChatSessions({ ...chatSessions, [conversationKey]: session }, currentSecUid);
    if (currentSummary) persistChatSummaries(nextSummaries, currentSecUid);
    void saveFriendChatState({ summaries: nextSummaries, unreadCounts }, currentSecUid).catch(() => undefined);
    emitFriendChatUpdated({
      currentSecUid,
      conversationKey,
      senderUid,
      message: upgradedMessage,
    });

    return {
      conversationKey,
      senderUid,
      message: upgradedMessage,
      nextMessages,
      session,
      upgradedExisting: true,
    };
  }

  const nextMessages: ChatMessages = {
    ...chatMessages,
    [conversationKey]: [...(chatMessages[conversationKey] || []), message].sort((a, b) => a.createdAt - b.createdAt),
  };
  const chatSummaries: ChatSummaries = readChatSummaries(currentSecUid);
  const currentSummary = chatSummaries[conversationKey];
  const nextSummaries: ChatSummaries = {
    ...chatSummaries,
    [conversationKey]: {
      latestMessage: message,
      latestMessageAt: Math.max(message.createdAt, currentSummary?.latestMessageAt || 0),
      unreadCount: (currentSummary?.unreadCount || 0) + 1,
    },
  };
  const unreadCounts: UnreadCounts = readUnreadCounts(currentSecUid);
  const nextUnreadCounts: UnreadCounts = {
    ...unreadCounts,
    [conversationKey]: (unreadCounts[conversationKey] || 0) + 1,
  };

  persistChatMessages(nextMessages, currentSecUid);
  const chatSessions = readChatSessions(currentSecUid);
  const displayName = readCachedFriendDisplayName(currentSecUid, senderUid);
  const session = refreshChatSession(chatSessions[conversationKey], nextMessages[conversationKey] || [], displayName);
  persistChatSessions({ ...chatSessions, [conversationKey]: session }, currentSecUid);
  persistChatSummaries(nextSummaries, currentSecUid);
  persistUnreadCounts(nextUnreadCounts, currentSecUid);
  void saveFriendChatState({ summaries: nextSummaries, unreadCounts: nextUnreadCounts }, currentSecUid).catch(() => undefined);
  useAppStore.getState().setFriendUnreadCount(unreadTotal(nextUnreadCounts));
  emitFriendChatUpdated({ currentSecUid, conversationKey, senderUid, message });

  return { conversationKey, senderUid, message, nextMessages, session, upgradedExisting: false };
}
