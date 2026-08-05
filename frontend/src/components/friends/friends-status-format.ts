import type { FriendStatusItem } from "./friends-status-types";

export function friendDisplayName(friend: FriendStatusItem | null | undefined) {
  if (!friend) return "未知用户";
  return friend.remarkName || friend.nickname || "未知用户";
}

export function formatLastActive(value: number) {
  if (!value) return "未显示";
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatUpdateTime(value: number) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatMessageTime(value: number) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isSameMessageDate(left: number, right: number) {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate();
}

export function formatMessageDate(value: number) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameMessageDate(value, today.getTime())) return "";
  if (isSameMessageDate(value, yesterday.getTime())) return "昨天";
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (date.getFullYear() === today.getFullYear()) return monthDay;
  return `${date.getFullYear()}年${monthDay}`;
}

export function formatMessageDividerTime(value: number, includeDate: boolean) {
  const time = formatMessageTime(value);
  const date = formatMessageDate(value);
  if (!includeDate && !date) return time;
  return date ? `${date} ${time}` : time;
}
