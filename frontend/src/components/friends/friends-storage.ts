import {
  CHAT_DRAFTS_KEY,
  CHAT_MESSAGES_KEY,
  CHAT_SUMMARIES_KEY,
  CHAT_UNREAD_KEY,
  type ChatDrafts,
  type ChatMessages,
  type ChatSummaries,
  type UnreadCounts,
} from "./friends-status-types";
import {
  compactChatMessagesForStorage,
  normalizeStoredChatMessage,
} from "./friends-message-utils";
import {
  isRecord,
  numberField,
  stringField,
} from "./friends-response-map";
import {
  normalizeMessageDirection,
  normalizeMessageStatus,
} from "./friends-message-format";
import { isSharedWorkPayload } from "@/lib/auto-return-shared-media";
import { readJson, writeJson } from "@/lib/storage";

export function getNamespacedKey(baseKey: string, currentSecUid?: string): string {
  if (!currentSecUid) return baseKey;
  return `${baseKey}.${currentSecUid}`;
}

export function readChatDrafts(currentSecUid?: string): ChatDrafts {
  const key = getNamespacedKey(CHAT_DRAFTS_KEY, currentSecUid);
  const parsed = readJson<unknown>(key, {});
  return isRecord(parsed) ? Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => typeof value === "string"),
  ) as ChatDrafts : {};
}

export function readChatMessages(currentSecUid?: string): ChatMessages {
  const key = getNamespacedKey(CHAT_MESSAGES_KEY, currentSecUid);
  const parsed = readJson<unknown>(key, {});
  if (!isRecord(parsed)) return {};
  const result: ChatMessages = {};
  for (const [secUid, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue;
    const messages = value
      .filter(isRecord)
      .map((message) => normalizeStoredChatMessage(secUid, message))
      .filter((message) => {
        if (!message.text || message.createdAt <= 0) return false;
        if (
          message.text.trim().startsWith('{') &&
          message.text.includes("command_type") &&
          !isSharedWorkPayload(message.rawContent || message.text)
        ) {
          return false;
        }
        return true;
      });
    if (messages.length > 0) {
      result[secUid] = messages;
    }
  }
  return result;
}

export function readUnreadCounts(currentSecUid?: string): UnreadCounts {
  const key = getNamespacedKey(CHAT_UNREAD_KEY, currentSecUid);
  const parsed = readJson<unknown>(key, {});
  if (!isRecord(parsed)) return {};
  const result: UnreadCounts = {};
  for (const [keyVal, value] of Object.entries(parsed)) {
    const count = Math.max(0, Number(value) || 0);
    if (count > 0) result[keyVal] = count;
  }
  return result;
}

export function readChatSummaries(currentSecUid?: string): ChatSummaries {
  const key = getNamespacedKey(CHAT_SUMMARIES_KEY, currentSecUid);
  const parsed = readJson<unknown>(key, {});
  if (!isRecord(parsed)) return {};
  const result: ChatSummaries = {};
  for (const [secUid, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue;
    const latestRaw = isRecord(value.latestMessage) ? value.latestMessage : undefined;
    const latestMessage = latestRaw ? {
      id: stringField(latestRaw, ["id"]) || `${secUid}-${numberField(latestRaw, ["createdAt"])}`,
      text: stringField(latestRaw, ["text"]),
      rawContent: stringField(latestRaw, ["rawContent", "raw_content"]) || undefined,
      imagePreviewUrl: stringField(latestRaw, ["imagePreviewUrl"]).startsWith("blob:") ? undefined : stringField(latestRaw, ["imagePreviewUrl"]) || undefined,
      createdAt: numberField(latestRaw, ["createdAt"]),
      status: normalizeMessageStatus(stringField(latestRaw, ["status"])),
      direction: normalizeMessageDirection(stringField(latestRaw, ["direction"])),
      senderUid: stringField(latestRaw, ["senderUid", "sender_uid"]),
      error: stringField(latestRaw, ["error"]) || undefined,
    } : undefined;
    const latestMessageAt = Math.max(
      numberField(value, ["latestMessageAt"]),
      latestMessage?.createdAt || 0,
    );
    const unreadCount = Math.max(0, numberField(value, ["unreadCount"]));
    if (latestMessageAt > 0 || unreadCount > 0) {
      result[secUid] = {
        latestMessage: latestMessage?.text ? latestMessage : undefined,
        latestMessageAt,
        unreadCount,
      };
    }
  }
  return result;
}

export function persistChatMessages(messages: ChatMessages, currentSecUid?: string) {
  const key = getNamespacedKey(CHAT_MESSAGES_KEY, currentSecUid);
  const next = compactChatMessagesForStorage(messages);
  writeJson(key, next);
}

export function sanitizePersistedSummaries(summaries: ChatSummaries): ChatSummaries {
  const result: ChatSummaries = {};
  for (const [secUid, value] of Object.entries(summaries)) {
    result[secUid] = {
      latestMessage: value.latestMessage ? {
        id: value.latestMessage.id,
        text: value.latestMessage.text,
        createdAt: value.latestMessage.createdAt,
        status: value.latestMessage.status === "pending" ? "error" : value.latestMessage.status,
        direction: value.latestMessage.direction,
        senderUid: value.latestMessage.senderUid,
        error: value.latestMessage.status === "pending" ? "发送未完成" : value.latestMessage.error,
      } : undefined,
      latestMessageAt: value.latestMessageAt,
      unreadCount: value.unreadCount,
    };
  }
  return result;
}

export function persistChatSummaries(summaries: ChatSummaries, currentSecUid?: string) {
  const key = getNamespacedKey(CHAT_SUMMARIES_KEY, currentSecUid);
  const next = sanitizePersistedSummaries(summaries);
  writeJson(key, next);
}

export function persistChatDrafts(drafts: ChatDrafts, currentSecUid?: string) {
  const key = getNamespacedKey(CHAT_DRAFTS_KEY, currentSecUid);
  writeJson(key, drafts);
}

export function persistUnreadCounts(counts: UnreadCounts, currentSecUid?: string) {
  const key = getNamespacedKey(CHAT_UNREAD_KEY, currentSecUid);
  writeJson(key, counts);
}
