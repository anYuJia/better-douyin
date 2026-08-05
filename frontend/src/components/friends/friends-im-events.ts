/**
 * 好友 IM 的前端事件桥。
 * 只负责浏览器内 CustomEvent 发布/订阅，不承接业务状态、网络请求或持久化。
 */
import type { LocalChatMessage } from "./friends-status-types";

export const GLOBAL_FRIEND_CHAT_UPDATED_EVENT = "dy-friend-chat-updated";
export const IM_ACCOUNT_READY_EVENT = "dy-im-account-ready";

export type FriendChatUpdatedDetail = {
  currentSecUid: string;
  conversationKey: string;
  senderUid: string;
  message: LocalChatMessage;
};

export type ImAccountReadyDetail = {
  accountEpoch: number;
  accountChanged: boolean;
};

function emitFriendImEvent<T>(eventName: string, detail: T): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<T>(eventName, { detail }));
}

function onFriendImEvent<T>(eventName: string, handler: (detail: T) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    handler(((event as CustomEvent<T>).detail || {}) as T);
  };
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}

export function emitFriendChatUpdated(detail: FriendChatUpdatedDetail): void {
  emitFriendImEvent(GLOBAL_FRIEND_CHAT_UPDATED_EVENT, detail);
}

export function onFriendChatUpdated(handler: (detail: FriendChatUpdatedDetail) => void): () => void {
  return onFriendImEvent(GLOBAL_FRIEND_CHAT_UPDATED_EVENT, handler);
}

export function emitImAccountReady(detail: ImAccountReadyDetail): void {
  emitFriendImEvent(IM_ACCOUNT_READY_EVENT, detail);
}

export function onImAccountReady(handler: (detail: ImAccountReadyDetail) => void): () => void {
  return onFriendImEvent(IM_ACCOUNT_READY_EVENT, handler);
}
