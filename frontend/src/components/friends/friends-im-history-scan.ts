/**
 * IM 历史分页扫描工具。
 * 只负责 cursor 翻页、has_more/next_cursor 归一化和 cursor 循环保护；
 * 每个调用方仍然自己决定安全边界、落库和副作用。
 */
import { getFriendMessageHistory } from "@/lib/tauri";
import type { JsonRecord } from "./friends-status-types";

type FriendMessageHistoryRequest = NonNullable<Parameters<typeof getFriendMessageHistory>[0]>;

export type ImHistoryScanPage = {
  pageIndex: number;
  cursor: number;
  messages: JsonRecord[];
  nextCursor: number;
  hasMore: boolean;
};

export type ImHistoryScanStopReason =
  | "callback"
  | "cursor_loop"
  | "exhausted"
  | "inactive"
  | "page_limit";

export type ImHistoryScanResult = {
  aborted: boolean;
  pages: number;
  messages: number;
  stopReason: ImHistoryScanStopReason;
};

type ImHistoryScanOptions = {
  maxPages: number;
  errorMessage: string;
  request?: Omit<FriendMessageHistoryRequest, "cursor">;
  shouldContinue?: () => boolean;
  onPage: (page: ImHistoryScanPage) => "continue" | "stop" | boolean | void | Promise<"continue" | "stop" | boolean | void>;
};

export async function scanImHistoryPages(options: ImHistoryScanOptions): Promise<ImHistoryScanResult> {
  let cursor = 0;
  let pages = 0;
  let messageCount = 0;
  const seenCursors = new Set<number>();
  const shouldContinue = options.shouldContinue || (() => true);

  for (let pageIndex = 0; pageIndex < options.maxPages; pageIndex += 1) {
    if (!shouldContinue()) {
      return { aborted: true, pages, messages: messageCount, stopReason: "inactive" };
    }

    const result = await getFriendMessageHistory({
      ...(options.request || {}),
      cursor,
    });
    if (!shouldContinue()) {
      return { aborted: true, pages, messages: messageCount, stopReason: "inactive" };
    }
    if (!result.success) {
      throw new Error(result.message || options.errorMessage);
    }

    const messages = Array.isArray(result.messages)
      ? result.messages.map((item) => item as unknown as JsonRecord)
      : [];
    const nextCursor = Number(result.next_cursor || 0) || 0;
    const hasMore = result.has_more === true || nextCursor > 0;
    pages += 1;
    messageCount += messages.length;

    const decision = await options.onPage({
      pageIndex,
      cursor,
      messages,
      nextCursor,
      hasMore,
    });
    if (decision === "stop" || decision === false) {
      return { aborted: false, pages, messages: messageCount, stopReason: "callback" };
    }
    if (!hasMore || !nextCursor) {
      return { aborted: false, pages, messages: messageCount, stopReason: "exhausted" };
    }
    if (seenCursors.has(nextCursor)) {
      return { aborted: false, pages, messages: messageCount, stopReason: "cursor_loop" };
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { aborted: false, pages, messages: messageCount, stopReason: "page_limit" };
}
