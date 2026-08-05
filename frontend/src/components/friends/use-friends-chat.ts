import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveFriendChatState } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";
import { UNKNOWN_FRIEND_KEY_PREFIX } from "./friends-local-storage";
import {
  type ChatDrafts,
  type ChatMessages,
  type ChatSessions,
  type ChatSummaries,
  type FriendStatusItem,
  type UnreadCounts,
} from "./friends-status-types";
import {
  persistChatDrafts,
  persistChatMessages,
  persistChatSummaries,
  persistUnreadCounts,
  readChatDrafts,
  readChatMessages,
  readChatSummaries,
  readUnreadCounts,
} from "./friends-status-utils";
import { persistChatSessions, readChatSessions, refreshChatSession } from "./friends-chat-session";
import { useFriendsChatPersistence } from "./use-friends-chat-persistence";
import { useFriendsMessageSender } from "./use-friends-message-sender";
import { useFriendsMessageHistory } from "./use-friends-message-history";
import { useFriendsImEvents } from "./use-friends-im-events";
import { onFriendChatUpdated } from "./friends-im-events";

function unreadTotal(counts: UnreadCounts) {
  return Object.values(counts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

export function useFriendsChat(
  friends: FriendStatusItem[],
  currentSecUid: string,
  setError: (msg: string) => void
) {
  const setFriendUnreadCount = useAppStore((state) => state.setFriendUnreadCount);

  const [chatDrafts, setChatDrafts] = useState<ChatDrafts>(() => readChatDrafts(currentSecUid));
  const [chatMessages, setChatMessages] = useState<ChatMessages>(() => readChatMessages(currentSecUid));
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>(() => readUnreadCounts(currentSecUid));
  const [chatSummaries, setChatSummaries] = useState<ChatSummaries>(() => readChatSummaries(currentSecUid));
  const [chatSessions, setChatSessions] = useState<ChatSessions>(() => readChatSessions(currentSecUid));
  const [selectedFriendId, setSelectedFriendId] = useState("");

  const selectedFriendIdRef = useRef(selectedFriendId);
  const currentSecUidRef = useRef(currentSecUid);

  const setUnreadTotal = useCallback((counts: UnreadCounts) => {
    setFriendUnreadCount(unreadTotal(counts));
  }, [setFriendUnreadCount]);

  const reloadPersistedChatState = useCallback(() => {
    const nextMessages = readChatMessages(currentSecUidRef.current);
    const nextUnread = readUnreadCounts(currentSecUidRef.current);
    const nextSummaries = readChatSummaries(currentSecUidRef.current);
    const nextSessions = readChatSessions(currentSecUidRef.current);
    setChatMessages(nextMessages);
    setUnreadCounts(nextUnread);
    setChatSummaries(nextSummaries);
    setChatSessions(nextSessions);
    setUnreadTotal(nextUnread);
  }, [setUnreadTotal]);

  const mergeUnknownFriendConversations = useCallback(() => {
    if (friends.length === 0) return false;
    const uidToSecUid = new Map(
      friends
        .filter((friend) => friend.uid && friend.secUid)
        .map((friend) => [friend.uid, friend.secUid] as const),
    );
    if (uidToSecUid.size === 0) return false;

    const nextMessages = readChatMessages(currentSecUidRef.current);
    const nextUnread = readUnreadCounts(currentSecUidRef.current);
    const nextSummaries = readChatSummaries(currentSecUidRef.current);
    const nextSessions = readChatSessions(currentSecUidRef.current);
    let changed = false;

    for (const key of Object.keys(nextMessages)) {
      if (!key.startsWith(UNKNOWN_FRIEND_KEY_PREFIX)) continue;
      const uid = key.slice(UNKNOWN_FRIEND_KEY_PREFIX.length);
      const secUid = uidToSecUid.get(uid);
      if (!secUid || secUid === key) continue;

      const existing = nextMessages[secUid] || [];
      const merged = [...existing];
      for (const message of nextMessages[key] || []) {
        if (!merged.some((item) => item.id === message.id)) {
          merged.push(message);
        }
      }
      if (merged.length > 0) {
        nextMessages[secUid] = merged.sort((a, b) => a.createdAt - b.createdAt);
      }
      delete nextMessages[key];

      const isSelectedConversation = secUid === selectedFriendIdRef.current;
      const sourceUnread = Math.max(0, nextUnread[key] || 0);
      if (isSelectedConversation) {
        delete nextUnread[secUid];
      } else if (sourceUnread > 0) {
        nextUnread[secUid] = (nextUnread[secUid] || 0) + sourceUnread;
      }
      delete nextUnread[key];

      const sourceSummary = nextSummaries[key];
      if (sourceSummary) {
        const currentSummary = nextSummaries[secUid];
        nextSummaries[secUid] = {
          latestMessage: sourceSummary.latestMessage || currentSummary?.latestMessage,
          latestMessageAt: Math.max(sourceSummary.latestMessageAt || 0, currentSummary?.latestMessageAt || 0),
          unreadCount: isSelectedConversation
            ? 0
            : (currentSummary?.unreadCount || 0) + Math.max(0, sourceSummary.unreadCount || 0),
        };
      }
      delete nextSummaries[key];
      const sourceSession = nextSessions[key];
      if (sourceSession) {
        const existingSession = nextSessions[secUid];
        nextSessions[secUid] = !existingSession || sourceSession.lastActivityAt > existingSession.lastActivityAt ? sourceSession : existingSession;
      }
      delete nextSessions[key];
      changed = true;
    }

    if (!changed) return false;
    persistChatMessages(nextMessages, currentSecUidRef.current);
    persistUnreadCounts(nextUnread, currentSecUidRef.current);
    persistChatSummaries(nextSummaries, currentSecUidRef.current);
    persistChatSessions(nextSessions, currentSecUidRef.current);
    setChatMessages(nextMessages);
    setUnreadCounts(nextUnread);
    setChatSummaries(nextSummaries);
    setChatSessions(nextSessions);
    setUnreadTotal(nextUnread);
    void saveFriendChatState({ summaries: nextSummaries, unreadCounts: nextUnread }, currentSecUidRef.current).catch(() => undefined);
    return true;
  }, [friends, setUnreadTotal]);

  useEffect(() => {
    currentSecUidRef.current = currentSecUid;
    if (currentSecUid) {
      setChatDrafts(readChatDrafts(currentSecUid));
      reloadPersistedChatState();
    }
  }, [currentSecUid, reloadPersistedChatState]);

  useEffect(() => {
    selectedFriendIdRef.current = selectedFriendId;
  }, [selectedFriendId]);

  useEffect(() => {
    const handler = () => {
      if (!mergeUnknownFriendConversations()) {
        reloadPersistedChatState();
      }
    };
    return onFriendChatUpdated(handler);
  }, [mergeUnknownFriendConversations, reloadPersistedChatState]);

  useEffect(() => {
    void mergeUnknownFriendConversations();
  }, [mergeUnknownFriendConversations]);

  const selectedFriend = useMemo(
    () => friends.find((friend) => friend.secUid === selectedFriendId) || null,
    [friends, selectedFriendId],
  );

  const selectedMessages = selectedFriend ? chatMessages[selectedFriend.secUid] || [] : [];

  useEffect(() => {
    setChatSessions((current) => {
      const next: ChatSessions = { ...current };
      let changed = false;
      for (const [conversationKey, messages] of Object.entries(chatMessages)) {
        const friend = friends.find((item) => item.secUid === conversationKey);
        const name = friend?.remarkName || friend?.nickname || `好友 ${friend?.uid?.slice(-4) || conversationKey.slice(-4)}`;
        const session = refreshChatSession(next[conversationKey], messages, name);
        const previous = next[conversationKey];
        if (!previous || previous.summary !== session.summary || previous.startedAt !== session.startedAt || previous.lastActivityAt !== session.lastActivityAt || previous.compressedThroughAt !== session.compressedThroughAt || previous.compressedMessageCount !== session.compressedMessageCount) {
          next[conversationKey] = session;
          changed = true;
        }
      }
      if (!changed) return current;
      persistChatSessions(next, currentSecUidRef.current);
      return next;
    });
  }, [chatMessages, friends]);

  const updateDraft = useCallback((secUid: string, value: string) => {
    setChatDrafts((current) => {
      const next = { ...current };
      if (value) {
        next[secUid] = value;
      } else {
        delete next[secUid];
      }
      persistChatDrafts(next, currentSecUidRef.current);
      return next;
    });
  }, []);

  const startNewChatSession = useCallback((friend: FriendStatusItem) => {
    const now = Date.now();
    setChatSessions((current) => {
      const next = { ...current, [friend.secUid]: { startedAt: now, lastActivityAt: now, summary: "", compressedThroughAt: now, compressedMessageCount: 0 } };
      persistChatSessions(next, currentSecUidRef.current);
      return next;
    });
  }, []);

  const compressChatSession = useCallback((friend: FriendStatusItem) => {
    setChatSessions((current) => {
      const next = { ...current, [friend.secUid]: refreshChatSession(current[friend.secUid], chatMessages[friend.secUid] || [], friend.remarkName || friend.nickname || `好友 ${friend.uid.slice(-4)}`, true) };
      persistChatSessions(next, currentSecUidRef.current);
      return next;
    });
  }, [chatMessages]);

  const {
    sendLocalMessage,
    sendLocalImageMessage,
    sendLocalVideoMessage,
  } = useFriendsMessageSender({
    currentSecUid,
    setChatMessages,
    updateDraft,
    setError,
  });

  const clearUnread = useCallback((secUid: string) => {
    const namespace = currentSecUidRef.current;
    const friend = friends.find((item) => item.secUid === secUid);
    const unknownKey = friend?.uid ? `${UNKNOWN_FRIEND_KEY_PREFIX}${friend.uid}` : "";
    const nextUnread = { ...readUnreadCounts(namespace) };
    delete nextUnread[secUid];
    if (unknownKey) delete nextUnread[unknownKey];

    const nextSummaries = { ...readChatSummaries(namespace) };
    const summary = nextSummaries[secUid];
    if (summary) {
      nextSummaries[secUid] = {
        ...summary,
        unreadCount: 0,
      };
    }
    if (unknownKey && nextSummaries[unknownKey]) {
      delete nextSummaries[unknownKey];
    }

    persistUnreadCounts(nextUnread, namespace);
    persistChatSummaries(nextSummaries, namespace);
    setUnreadCounts(nextUnread);
    setChatSummaries(nextSummaries);
    setUnreadTotal(nextUnread);
    void saveFriendChatState({ summaries: nextSummaries, unreadCounts: nextUnread }, namespace).catch(() => undefined);
  }, [friends, setUnreadTotal]);

  const selectFriend = useCallback((friend: FriendStatusItem) => {
    setSelectedFriendId(friend.secUid);
    clearUnread(friend.secUid);
  }, [clearUnread]);

  const {
    historyState,
    selectedHistory,
    loadHistoryMessages,
  } = useFriendsMessageHistory({
    friends,
    chatMessages,
    setChatMessages,
    currentSecUid,
    selectedFriend,
  });

  const { imStatus } = useFriendsImEvents();

  useEffect(() => {
    if (friends.length === 0) {
      setSelectedFriendId("");
      return;
    }
    if (selectedFriendId && !friends.some((friend) => friend.secUid === selectedFriendId)) {
      setSelectedFriendId("");
    }
  }, [friends, selectedFriendId]);

  useEffect(() => {
    if (selectedFriend) {
      clearUnread(selectedFriend.secUid);
    }
  }, [clearUnread, selectedFriend]);

  useFriendsChatPersistence({
    currentSecUid,
    selectedFriendIdRef,
    chatMessages,
    unreadCounts,
    chatSummaries,
    setChatMessages,
    setUnreadCounts,
    setChatSummaries,
  });

  return {
    chatDrafts,
    chatMessages,
    unreadCounts,
    chatSummaries,
    chatSessions,
    historyState,
    selectedFriendId,
    setSelectedFriendId,
    selectedFriend,
    selectedMessages,
    selectedHistory,
    imStatus,
    setChatDrafts,
    setChatMessages,
    setUnreadCounts,
    setChatSummaries,
    updateDraft,
    sendLocalMessage,
    sendLocalImageMessage,
    sendLocalVideoMessage,
    loadHistoryMessages,
    clearUnread,
    selectFriend,
    startNewChatSession,
    compressChatSession,
  };
}
