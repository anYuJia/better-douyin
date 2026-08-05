import type { FriendOnlineStatusResponse } from "@/lib/tauri";
import {
  type FriendStatusItem,
  type JsonRecord,
} from "./friends-status-types";
import {
  formatLastActive,
} from "./friends-status-format";

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function stringField(record: JsonRecord | undefined, keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    if (typeof record[key] === "string") return record[key] as string;
    if (typeof record[key] === "number" || typeof record[key] === "boolean") return String(record[key]);
  }
  return "";
}

export function numberField(record: JsonRecord | undefined, keys: string[]) {
  if (!record) return 0;
  for (const key of keys) {
    if (typeof record[key] === "number") return record[key] as number;
    if (typeof record[key] === "string") {
      const parsed = Number(record[key]);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

export function walkRecords(value: unknown, visit: (record: JsonRecord) => void) {
  if (isRecord(value)) {
    visit(value);
    Object.values(value).forEach((child) => walkRecords(child, visit));
  } else if (Array.isArray(value)) {
    value.forEach((child) => walkRecords(child, visit));
  }
}

export function arrayField(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function extractSecUid(record: JsonRecord) {
  return stringField(record, ["sec_uid", "secUid", "sec_user_id", "secUserId"]);
}

export function firstUrl(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    return firstUrl(value[0]);
  }
  if (isRecord(value)) {
    for (const key of ["large_url_list", "medium_url_list", "origin_url_list", "url_list", "urlList", "thumb_url_list"]) {
      const list = value[key];
      if (Array.isArray(list) && list.length > 0) {
        const url = firstUrl(list);
        if (url) return url;
      }
    }
  }
  return "";
}

export function extractAvatar(record: JsonRecord | undefined) {
  if (!record) return "";
  const avatar = record.avatar_thumb || record.avatarThumb || record.avatar_medium || record.avatarMedium;
  const url = firstUrl(avatar);
  if (url) return url;
  const schema = stringField(record, ["avatar_uri", "avatarUri", "uri"]);
  if (schema) return schema;
  return "";
}

export function extractIds(text: string) {
  const matches = text.match(/MS4w\.?LjAB[A-Za-z0-9_-]+/g) || [];
  const lines = text
    .split(/[\n,\s]+/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item.startsWith("MS4wLjAB") || item.startsWith("MS4w.LjAB"));
  return Array.from(new Set([...matches, ...lines]));
}

export function responseNowSeconds(response: FriendOnlineStatusResponse) {
  const active = response.active_status;
  if (isRecord(active) && isRecord(active.extra)) {
    const now = numberField(active.extra, ["now"]);
    if (now > 1_000_000_000_000) return Math.floor(now / 1000);
    if (now > 0) return Math.floor(now);
  }
  return Math.floor(Date.now() / 1000);
}

export function collectRecordsBySecUid(value: unknown) {
  const map = new Map<string, JsonRecord>();
  const direct = arrayField(value);
  if (direct.length > 0) {
    direct.forEach((record) => {
      const secUid = extractSecUid(record);
      if (secUid) map.set(secUid, record);
    });
    return map;
  }

  walkRecords(value, (record) => {
    const secUid = extractSecUid(record);
    if (secUid) map.set(secUid, record);
  });
  return map;
}

export function normalizeServerMessageAt(value: number) {
  if (!value) return 0;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

export function mapResponse(response: FriendOnlineStatusResponse): FriendStatusItem[] {
  const nowSeconds = responseNowSeconds(response);
  const users = collectRecordsBySecUid(response.user_info);
  const statuses = collectRecordsBySecUid(response.active_status);
  const recentInteractions = collectRecordsBySecUid(response.recent_interactions);
  const ids = Array.from(new Set([
    ...statuses.keys(),
    ...users.keys(),
    ...(response.sec_user_ids || []),
  ]));

  return ids
    .map((secUid) => {
      const user = users.get(secUid);
      const status = statuses.get(secUid);
      const recentInteraction = recentInteractions.get(secUid);
      const lastActiveTime = numberField(status, ["last_active_time", "active_time", "last_seen"]);
      const serverLatestMessageAt = normalizeServerMessageAt(numberField(recentInteraction, [
        "last_share_timestamp",
        "timestamp",
        "latestMessageAt",
      ]));
      const conversationId =
        stringField(recentInteraction, ["conversation_id", "conversationId", "conv_id", "convId"]) ||
        stringField(status, ["conversation_id", "conversationId", "conv_id", "convId"]);
      const conversationShortId =
        numberField(recentInteraction, ["conversation_short_id", "conversationShortId", "conv_short_id", "convShortId"]) ||
        numberField(status, ["conversation_short_id", "conversationShortId", "conv_short_id", "convShortId"]);
      const conversationType =
        numberField(recentInteraction, ["conversation_type", "conversationType", "conv_type", "convType"]) ||
        numberField(status, ["conversation_type", "conversationType", "conv_type", "convType"]) ||
        1;
      const online =
        lastActiveTime > 0 &&
        nowSeconds - lastActiveTime >= 0 &&
        nowSeconds - lastActiveTime <= 60;

      return {
        secUid,
        uid: stringField(user, ["uid", "user_id", "id", "uid_str", "short_id"]) ||
          stringField(recentInteraction, ["uid", "user_id", "id", "uid_str"]),
        nickname: stringField(user, ["nickname", "nick_name", "display_name", "unique_id"]),
        remarkName: stringField(user, ["remark_name"]),
        avatar: extractAvatar(user),
        signature: stringField(user, ["signature", "desc"]),
        online,
        statusText: online ? "在线" : lastActiveTime > 0 ? "最近活跃" : "未显示",
        lastActive: formatLastActive(lastActiveTime),
        lastActiveTime,
        serverLatestMessageAt,
        conversationId,
        conversationShortId,
        conversationType,
      };
    });
}
