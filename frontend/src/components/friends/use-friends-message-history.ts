import { useCallback, useEffect, useState, useRef } from "react";
import { getFriendMessageHistory } from "@/lib/tauri";
import { isSharedWorkPayload } from "@/lib/auto-return-shared-media";
import type { FriendMessageHistoryItem } from "@/lib/contracts";
import {
  type ChatMessages,
  type FriendStatusItem,
  type HistoryPageState,
  type JsonRecord,
  type LocalChatMessage,
} from "./friends-status-types";
import {
  fallbackMessageText,
  isRecord,
  numberField,
  parseJsonContent,
  persistChatMessages,
  stringField,
} from "./friends-status-utils";

interface HistoryProps {
  friends: FriendStatusItem[];
  chatMessages: ChatMessages;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessages>>;
  currentSecUid: string;
  selectedFriend: FriendStatusItem | null;
}

function isNativeVideoRawContent(rawContent: string | undefined) {
  const parsed = parseJsonContent(rawContent || "");
  return Boolean(parsed && isRecord(parsed.video) && isRecord(parsed.poster));
}

// The realtime IM listener stores a server message ID in a conversation
// namespace. Rich cards can fall back to `index_in_conversation`, which is
// only unique within that conversation. History rows must use the same ID so
// opening a chat cannot append a second copy of a card that realtime delivery
// already persisted.
export function buildHistoryMessageStorageId(
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

function historyConversationNamespace(item: JsonRecord, friend: FriendStatusItem, senderUid: string) {
  const conversationId = stringField(item, ["conversation_id", "conversationId"]).trim();
  if (conversationId) return `conversation:${conversationId}`;
  const conversationShortId = stringField(item, ["conversation_short_id", "conversationShortId"]).trim();
  if (conversationShortId) return `conversation-short:${conversationShortId}`;
  return senderUid ? `uid:${senderUid}` : `friend:${friend.secUid}`;
}

function matchesLegacyHistoryMessageId(
  existingId: string,
  friend: FriendStatusItem,
  senderUid: string,
  messageId: string,
  createdAt: number,
) {
  if (messageId && existingId === messageId) return true;
  if (!messageId && existingId === `${friend.secUid}-${createdAt}`) return true;
  return !messageId && Boolean(senderUid) && existingId === `uid:${senderUid}-${createdAt}`;
}

function sharedPayloadRichness(message: LocalChatMessage) {
  const rawContent = String(message.rawContent || "").trim();
  if (!rawContent || rawContent === "[图集]" || rawContent === "[分享作品]") return 0;
  return isSharedWorkPayload(rawContent) ? 2 : 1;
}

function shouldUpgradeSharedPlaceholder(existing: LocalChatMessage, incoming: LocalChatMessage) {
  return sharedPayloadRichness(incoming) > sharedPayloadRichness(existing);
}

export function useFriendsMessageHistory({
  friends,
  chatMessages,
  setChatMessages,
  currentSecUid,
  selectedFriend,
}: HistoryProps) {
  const [historyState, setHistoryState] = useState<HistoryPageState>({});
  const currentSecUidRef = useRef(currentSecUid);

  useEffect(() => {
    currentSecUidRef.current = currentSecUid;
  }, [currentSecUid]);

  const mergeHistoryMessages = useCallback((items: FriendMessageHistoryItem[], fallbackFriend?: FriendStatusItem | null) => {
    if (!items.length) return 0;
    let mergedCount = 0;
    setChatMessages((current) => {
      const next: ChatMessages = { ...current };
      for (const item of items) {
        const conversationId = stringField(item as JsonRecord, ["conversation_id", "conversationId"]);
        const senderUid = stringField(item as JsonRecord, ["sender_uid", "senderUid"]);
        const rawContent = stringField(item as JsonRecord, ["raw_content", "rawContent"]) || undefined;
        const text = stringField(item as JsonRecord, ["content", "text"]) || fallbackMessageText(rawContent);
        const serverMessageId = stringField(item as JsonRecord, ["server_message_id", "serverMessageId"]);
        const messageId = Number(serverMessageId) > 0
          ? serverMessageId
          : stringField(item as JsonRecord, [
            "index_in_conversation",
            "indexInConversation",
            "message_id",
            "messageId",
            "id",
          ]);
        if (!text) continue;
        if (
          text.trim().startsWith('{') &&
          text.includes("command_type") &&
          !isSharedWorkPayload(rawContent || text)
        ) {
          continue;
        }
        const friend = fallbackFriend || friends.find((candidate) =>
          (senderUid && candidate.uid === senderUid) ||
          (candidate.uid && conversationId.includes(candidate.uid))
        );
        if (!friend) continue;
        const rawCreatedAt = numberField(item as JsonRecord, ["created_at", "createdAt", "create_time", "createTime"]);
        const createdAt = rawCreatedAt > 0 && rawCreatedAt < 10_000_000_000
          ? rawCreatedAt * 1000
          : rawCreatedAt || Date.now();
        const messageNamespace = historyConversationNamespace(item as JsonRecord, friend, senderUid);
        const message: LocalChatMessage = {
          id: buildHistoryMessageStorageId(messageNamespace, messageId, createdAt),
          text,
          rawContent,
          createdAt,
          status: "sent",
          direction: senderUid && senderUid === friend.uid ? "in" : "out",
          senderUid,
        };
        const currentMessages = next[friend.secUid] || [];
        const isNativeVideo = isNativeVideoRawContent(message.rawContent);
        const localMatchIndex = currentMessages.findIndex((existing) =>
          existing.direction === "out" &&
          (existing.text === message.text || (isNativeVideo && Boolean(existing.videoPreviewUrl))) &&
          Math.abs(existing.createdAt - message.createdAt) < 60000 &&
          existing.id.includes(friend.secUid)
        );
        if (localMatchIndex !== -1) {
          const matchedList = [...currentMessages];
          matchedList[localMatchIndex] = {
            ...matchedList[localMatchIndex],
            id: message.id,
            text: message.text || matchedList[localMatchIndex].text,
            rawContent: message.rawContent || matchedList[localMatchIndex].rawContent,
            status: "sent",
          };
          next[friend.secUid] = matchedList.sort((a, b) => a.createdAt - b.createdAt);
          mergedCount += 1;
          continue;
        }
        const existingIndex = currentMessages.findIndex((existing) =>
          existing.id === message.id ||
          matchesLegacyHistoryMessageId(existing.id, friend, senderUid, messageId, createdAt),
        );
        if (existingIndex !== -1) {
          const existing = currentMessages[existingIndex];
          if (!shouldUpgradeSharedPlaceholder(existing, message)) continue;
          const upgradedList = [...currentMessages];
          upgradedList[existingIndex] = {
            ...existing,
            text: message.text || existing.text,
            rawContent: message.rawContent || existing.rawContent,
            senderUid: message.senderUid || existing.senderUid,
          };
          next[friend.secUid] = upgradedList.sort((a, b) => a.createdAt - b.createdAt);
          mergedCount += 1;
          continue;
        }
        next[friend.secUid] = [...currentMessages, message].sort((a, b) => a.createdAt - b.createdAt);
        mergedCount += 1;
      }
      if (mergedCount > 0) {
        persistChatMessages(next, currentSecUidRef.current);
        return next;
      }
      return current;
    });
    return mergedCount;
  }, [friends, setChatMessages]);

  const loadHistoryMessages = useCallback(async (friend: FriendStatusItem, cursor = 0) => {
    const current = historyState[friend.secUid];
    if (current?.loading) return;
    if (cursor > 0 && current?.hasMore === false) return;
    const currentMessages = chatMessages[friend.secUid] || [];
    setHistoryState((state) => ({
      ...state,
      [friend.secUid]: {
        loaded: Boolean(state[friend.secUid]?.loaded),
        loading: true,
        nextCursor: state[friend.secUid]?.nextCursor || 0,
        hasMore: state[friend.secUid]?.hasMore ?? true,
        error: "",
      },
    }));
    try {
      const result = await getFriendMessageHistory({
        cursor,
        toUserId: friend.uid,
        conversationId: friend.conversationId,
        conversationShortId: friend.conversationShortId,
        conversationType: friend.conversationType,
      });
      if (!result.success) {
        throw new Error(result.message || "获取历史消息失败");
      }
      const messages = Array.isArray(result.messages) ? result.messages : [];
      mergeHistoryMessages(messages, friend);
      const nextCursor = Number(result.next_cursor || 0) || 0;
      setHistoryState((state) => ({
        ...state,
        [friend.secUid]: {
          loaded: true,
          loading: false,
          nextCursor,
          hasMore: Boolean(nextCursor && messages.length > 0),
          error: "",
        },
      }));
    } catch (caught) {
      setHistoryState((state) => ({
        ...state,
        [friend.secUid]: {
          loaded: cursor === 0 ? true : Boolean(state[friend.secUid]?.loaded),
          loading: false,
          nextCursor: state[friend.secUid]?.nextCursor || 0,
          hasMore: false,
          error: cursor === 0 && currentMessages.length === 0
            ? caught instanceof Error ? caught.message : "获取历史消息失败"
            : "",
        },
      }));
    }
  }, [chatMessages, historyState, mergeHistoryMessages]);

  // First-time loading effect for conversation history
  useEffect(() => {
    if (!selectedFriend || !selectedFriend.uid) return;
    const current = historyState[selectedFriend.secUid];
    if (current?.loaded || current?.loading) return;
    void loadHistoryMessages(selectedFriend, 0);
  }, [historyState, loadHistoryMessages, selectedFriend]);

  const selectedHistory = selectedFriend ? historyState[selectedFriend.secUid] : undefined;

  return {
    historyState,
    selectedHistory,
    loadHistoryMessages,
    mergeHistoryMessages,
  };
}
