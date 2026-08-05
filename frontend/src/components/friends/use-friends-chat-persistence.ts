import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { getFriendChatState, saveFriendChatState } from "@/lib/tauri";
import {
  type ChatMessages,
  type ChatSummaries,
  type UnreadCounts,
} from "./friends-status-types";
import {
  isRecord,
  latestChatMessage,
  normalizeMessageDirection,
  normalizeMessageStatus,
  numberField,
  persistChatMessages,
  persistChatSummaries,
  persistUnreadCounts,
  readChatSummaries,
  stringField,
} from "./friends-status-utils";

interface PersistenceProps {
  currentSecUid: string;
  selectedFriendIdRef: React.RefObject<string>;
  chatMessages: ChatMessages;
  unreadCounts: UnreadCounts;
  chatSummaries: ChatSummaries;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessages>>;
  setUnreadCounts: React.Dispatch<React.SetStateAction<UnreadCounts>>;
  setChatSummaries: React.Dispatch<React.SetStateAction<ChatSummaries>>;
}

export function useFriendsChatPersistence({
  currentSecUid,
  selectedFriendIdRef,
  chatMessages,
  unreadCounts,
  chatSummaries,
  setChatMessages,
  setUnreadCounts,
  setChatSummaries,
}: PersistenceProps) {
  const setFriendUnreadCount = useAppStore((state) => state.setFriendUnreadCount);
  const chatStateLoadedRef = useRef(false);
  const currentSecUidRef = useRef(currentSecUid);

  useEffect(() => {
    currentSecUidRef.current = currentSecUid;
  }, [currentSecUid]);

  // Load chat state from database and sync with local storage on mount/account change
  useEffect(() => {
    let cancelled = false;
    void getFriendChatState()
      .then((result) => {
        if (cancelled) return;
        chatStateLoadedRef.current = true;
        const summaries = isRecord(result.summaries) ? result.summaries : {};
        const unread = isRecord(result.unreadCounts) ? result.unreadCounts : {};
        const nextSummaries = readChatSummaries(currentSecUidRef.current);
        const nextUnread: UnreadCounts = {};
        let messagesMerged = false;

        setChatMessages((currentChatMessages) => {
          const nextChatMessages = { ...currentChatMessages };
          for (const [secUid, value] of Object.entries(summaries)) {
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

            if (latestMessage && latestMessage.text) {
              const currentList = nextChatMessages[secUid] || [];
              if (!currentList.some((existing) =>
                existing.id === latestMessage.id ||
                (existing.text === latestMessage.text && Math.abs(existing.createdAt - latestMessage.createdAt) < 60000)
              )) {
                nextChatMessages[secUid] = [...currentList, latestMessage].sort((a, b) => a.createdAt - b.createdAt);
                messagesMerged = true;
              }
            }

            const latestMessageAt = Math.max(numberField(value, ["latestMessageAt"]), latestMessage?.createdAt || 0);
            const unreadCount = Math.max(0, Number(unread[secUid]) || 0);
            const current = nextSummaries[secUid];
            if (latestMessageAt >= (current?.latestMessageAt || 0)) {
              nextSummaries[secUid] = {
                latestMessage: latestMessage?.text ? latestMessage : current?.latestMessage,
                latestMessageAt,
                unreadCount: secUid === selectedFriendIdRef.current ? 0 : unreadCount,
              };
            }
          }
          if (messagesMerged) {
            persistChatMessages(nextChatMessages, currentSecUidRef.current);
          }
          return nextChatMessages;
        });

        for (const [secUid, value] of Object.entries(unread)) {
          const count = Math.max(0, Number(value) || 0);
          if (!count) continue;
          nextSummaries[secUid] = {
            latestMessage: nextSummaries[secUid]?.latestMessage,
            latestMessageAt: nextSummaries[secUid]?.latestMessageAt || 0,
            unreadCount: secUid === selectedFriendIdRef.current ? 0 : count,
          };
          if (secUid !== selectedFriendIdRef.current) {
            nextUnread[secUid] = count;
          }
        }
        persistChatSummaries(nextSummaries, currentSecUidRef.current);
        setChatSummaries(nextSummaries);
        persistUnreadCounts(nextUnread, currentSecUidRef.current);
        setUnreadCounts(nextUnread);
      })
      .catch(() => {
        chatStateLoadedRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [currentSecUid, setChatMessages, setChatSummaries, setUnreadCounts, selectedFriendIdRef]);

  // Sync summaries when messages or unread count changes
  useEffect(() => {
    setChatSummaries((current) => {
      let changed = false;
      const next: ChatSummaries = { ...current };
      for (const [secUid, messages] of Object.entries(chatMessages)) {
        const latestMessage = latestChatMessage(messages);
        if (!latestMessage) continue;
        const unreadCount = unreadCounts[secUid] || 0;
        const currentSummary = next[secUid];
        if (
          latestMessage.createdAt >= (currentSummary?.latestMessageAt || 0) ||
          unreadCount !== (currentSummary?.unreadCount || 0)
        ) {
          next[secUid] = {
            latestMessage,
            latestMessageAt: Math.max(latestMessage.createdAt, currentSummary?.latestMessageAt || 0),
            unreadCount,
          };
          changed = true;
        }
      }
      for (const [secUid, count] of Object.entries(unreadCounts)) {
        if ((next[secUid]?.unreadCount || 0) === count) continue;
        next[secUid] = {
          latestMessage: next[secUid]?.latestMessage,
          latestMessageAt: next[secUid]?.latestMessageAt || 0,
          unreadCount: count,
        };
        changed = true;
      }
      if (!changed) return current;
      persistChatSummaries(next, currentSecUidRef.current);
      return next;
    });
  }, [chatMessages, unreadCounts, setChatSummaries]);

  // Aggregate unread counts in app store
  useEffect(() => {
    const total = Object.values(unreadCounts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    setFriendUnreadCount(total);
  }, [setFriendUnreadCount, unreadCounts]);

  // Auto-save summaries and unread counts with 350ms debounce
  useEffect(() => {
    if (!chatStateLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      void saveFriendChatState({
        summaries: chatSummaries,
        unreadCounts,
      }, currentSecUidRef.current).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [chatSummaries, unreadCounts]);
}
