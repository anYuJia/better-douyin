import { readJson, readString, writeJson, writeString } from "@/lib/storage";
import {
  CURRENT_USER_AVATAR_KEY,
  STORAGE_KEY,
} from "./friends-status-types";

export const FRIEND_UID_NAME_CACHE_KEY = "dy.friend.uidNameCache";
export const UNKNOWN_FRIEND_KEY_PREFIX = "uid:";

export type FriendNameCache = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function unknownFriendKey(senderUid: string): string {
  return `${UNKNOWN_FRIEND_KEY_PREFIX}${senderUid}`;
}

export function friendNameCacheKey(currentSecUid?: string): string {
  return currentSecUid ? `${FRIEND_UID_NAME_CACHE_KEY}.${currentSecUid}` : FRIEND_UID_NAME_CACHE_KEY;
}

export function readFriendNameCache(currentSecUid?: string): FriendNameCache {
  const parsed = readJson<unknown>(friendNameCacheKey(currentSecUid), {});
  if (!isRecord(parsed)) return {};
  const cache: FriendNameCache = {};
  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== "string") continue;
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (key && value) cache[key] = value;
  }
  return cache;
}

export function writeFriendNameCache(currentSecUid: string, cache: FriendNameCache): void {
  writeJson(friendNameCacheKey(currentSecUid), cache);
}

export function readCachedFriendDisplayName(
  currentSecUid: string,
  senderUid: string,
  fallback = "好友",
): string {
  const name = readFriendNameCache(currentSecUid)[senderUid.trim()];
  return name || fallback;
}

export function readFriendStatusInput(): string {
  return readString(STORAGE_KEY, "");
}

export function writeFriendStatusInput(value: string): void {
  writeString(STORAGE_KEY, value);
}

export function readCurrentUserAvatar(): string {
  return readString(CURRENT_USER_AVATAR_KEY, "");
}

export function writeCurrentUserAvatar(value: string): void {
  writeString(CURRENT_USER_AVATAR_KEY, value);
}
