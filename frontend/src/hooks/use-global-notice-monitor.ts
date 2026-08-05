import { useCallback, useEffect, useRef } from "react";
import { getNotices, publishComment, setUserFollowed, suggestAiInteraction } from "@/lib/tauri";
import type { NoticeItem, NoticeUser } from "@/lib/contracts";
import { useAppStore, useLogStore } from "@/stores/app-store";
import {
  getAiAutoSendDelayMs,
  normalizeAiSuggestions,
  readAiAutomationConfig,
  rememberAutomationKey,
  shouldAutomateText,
  waitForAiAutoSend,
} from "@/lib/ai-automation";

export const NOTICE_REFRESH_OPTIONS = [
  { label: "不自动刷新", value: 0 },
  { label: "15 秒", value: 15 },
  { label: "30 秒", value: 30 },
  { label: "60 秒", value: 60 },
  { label: "120 秒", value: 120 },
];

const autoRepliedNoticeIds = new Set<string>();
const autoFollowedNoticeIds = new Set<string>();

function noticeUserName(user: NoticeUser | undefined) {
  return user?.nickname?.trim() || user?.unique_id?.trim() || user?.uid?.trim() || "用户";
}

function hasAlreadyFollowed(user: NoticeUser) {
  const followStatus = Number(user.follow_status ?? 0);
  return Number.isFinite(followStatus) && followStatus > 0;
}

async function runFollowBackAutomation(
  notice: NoticeItem,
  accountSecUid: string,
  config: NonNullable<Awaited<ReturnType<typeof readAiAutomationConfig>>>,
  handled: number,
  addLog: (message: string, level: "info" | "success" | "warning" | "error") => void
) {
  if (!config.auto_follow_back_on_new_follower || notice.type !== 33) return handled;
  const users = (notice.users || []).filter((user) => String(user.uid || "").trim());
  if (users.length === 0) return handled;

  for (const user of users) {
    if (useAppStore.getState().currentSecUid !== accountSecUid) break;
    if (handled >= config.auto_max_actions_per_run) break;
    if (hasAlreadyFollowed(user)) continue;
    const uid = String(user.uid || "").trim();
    const scopedKey = accountSecUid + ":follow:" + (notice.id || notice.create_time) + ":" + uid;
    if (!rememberAutomationKey(autoFollowedNoticeIds, scopedKey)) continue;

    handled += 1;
    try {
      const result = await setUserFollowed(uid, true);
      if (result.success) {
        addLog("收到关注自动回关成功：" + noticeUserName(user), "success");
      } else {
        addLog(result.message || ("收到关注自动回关失败：" + noticeUserName(user)), "warning");
      }
    } catch (error) {
      addLog(error instanceof Error ? error.message : ("收到关注自动回关失败：" + noticeUserName(user)), "warning");
    }
  }
  return handled;
}

function noticeTimeMs(notice: NoticeItem) {
  const raw = notice.create_time || notice.comment?.create_time || 0;
  if (!raw || raw <= 0) return 0;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

export async function runNoticeAutomation(items: NoticeItem[], accountSecUid = useAppStore.getState().currentSecUid) {
  if (!accountSecUid) return;
  const config = await readAiAutomationConfig();
  if (!config?.enabled || !config.auto_monitor_notices) return;
  if (!config.auto_send_comments && !config.auto_follow_back_on_new_follower) return;
  const addLog = useLogStore.getState().addLog;
  const refreshIntervalSeconds = useAppStore.getState().noticeRefreshIntervalSeconds || 30;
  const maxNoticeAgeMs = Math.max(refreshIntervalSeconds * 2 + 10, 60) * 1000;
  const now = Date.now();
  let handled = 0;

  for (const notice of items) {
    if (useAppStore.getState().currentSecUid !== accountSecUid) break;

    // Ignore old historical notices outside the allowed refresh time window.
    const noticeTime = noticeTimeMs(notice);
    if (noticeTime > 0 && now - noticeTime > maxNoticeAgeMs) {
      continue;
    }

    handled = await runFollowBackAutomation(notice, accountSecUid, config, handled, addLog);
    if (handled >= config.auto_max_actions_per_run) break;
    if (!config.auto_send_comments) continue;

    const comment = notice.comment;
    const awemeId = notice.aweme?.aweme_id;
    const key = comment?.cid || notice.id;
    const scopedKey = key ? `${accountSecUid}:${key}` : "";
    if (!scopedKey || autoRepliedNoticeIds.has(scopedKey)) continue;
    if (handled >= config.auto_max_actions_per_run) break;
    if (notice.type !== 31 || !comment || !awemeId) continue;

    const matchText = [
      notice.content,
      notice.comment_text,
      comment.text,
      comment.user?.nickname,
      notice.aweme?.desc,
    ].filter(Boolean).join(" ");
    if (!shouldAutomateText(matchText, config, "comment")) continue;
    if (!rememberAutomationKey(autoRepliedNoticeIds, scopedKey)) continue;

    handled += 1;
    try {
      const result = await suggestAiInteraction({
        target: "comment",
        context: [
          notice.aweme?.desc ? `视频文案：${notice.aweme.desc}` : "",
          notice.content ? `通知：${notice.content}` : "",
          comment.reply_to_text ? `上文：${comment.reply_to_text}` : "",
          comment.text ? `${comment.user?.nickname || "用户"}：${comment.text}` : "",
        ].filter(Boolean).join("\n").slice(-900),
        incoming_text: comment.text.slice(0, 360),
        author_name: comment.user?.nickname || "",
        tone: "friendly",
        language: "zh-CN",
        max_suggestions: 3,
      });
      const suggestions = normalizeAiSuggestions(result);
      if (!result.actions?.send_comment || suggestions.length === 0) continue;
      await waitForAiAutoSend(getAiAutoSendDelayMs(result.auto_send_delay_ms));
      if (useAppStore.getState().currentSecUid !== accountSecUid) break;
      const publish = await publishComment(
        awemeId,
        suggestions[0],
        comment.root_cid,
        comment.is_sub ? comment.cid : "0"
      );
      if (publish.success) {
        addLog(`通知自动回复成功：${comment.user?.nickname || "用户"}`, "success");
      } else {
        addLog(publish.message || "通知自动回复失败", "warning");
      }
    } catch (error) {
      addLog(error instanceof Error ? error.message : "通知自动回复失败", "warning");
    }
  }
}

export function useGlobalNoticeMonitor() {
  const cookieLoggedIn = useAppStore((state) => state.cookieLoggedIn);
  const currentSecUid = useAppStore((state) => state.currentSecUid);
  const refreshIntervalSeconds = useAppStore((state) => state.noticeRefreshIntervalSeconds);
  const setNoticeUnreadCount = useAppStore((state) => state.setNoticeUnreadCount);
  const setNoticeItems = useAppStore((state) => state.setNoticeItems);
  const setNoticeAutoRefreshing = useAppStore((state) => state.setNoticeAutoRefreshing);
  const setNoticeLastUpdatedAt = useAppStore((state) => state.setNoticeLastUpdatedAt);
  const inFlightRef = useRef(false);
  const lastItemsSignatureRef = useRef("");

  const poll = useCallback(async () => {
    if (!cookieLoggedIn || !currentSecUid || refreshIntervalSeconds <= 0 || inFlightRef.current) return;
    const accountAtStart = currentSecUid;
    inFlightRef.current = true;
    setNoticeAutoRefreshing(true);
    try {
      const resp = await getNotices({ count: 20 });
      if (useAppStore.getState().currentSecUid !== accountAtStart) return;
      if (resp.success) {
        const items = resp.notices || [];
        // 数据与上次一致时跳过 setState，避免角标/列表每轮无谓重渲染。
        const signature = JSON.stringify(items);
        if (signature !== lastItemsSignatureRef.current) {
          lastItemsSignatureRef.current = signature;
          setNoticeItems(items);
          setNoticeUnreadCount(Number(resp.unread_count || 0));
        }
        setNoticeLastUpdatedAt(Date.now());
        void runNoticeAutomation(items, accountAtStart);
      }
    } catch {
      // 后台刷新失败不打断当前界面，下一轮继续尝试。
    } finally {
      inFlightRef.current = false;
      setNoticeAutoRefreshing(false);
    }
  }, [cookieLoggedIn, currentSecUid, refreshIntervalSeconds, setNoticeAutoRefreshing, setNoticeItems, setNoticeLastUpdatedAt, setNoticeUnreadCount]);

  useEffect(() => {
    autoRepliedNoticeIds.clear();
    autoFollowedNoticeIds.clear();
    inFlightRef.current = false;
    setNoticeItems([]);
    setNoticeUnreadCount(0);
    setNoticeLastUpdatedAt(0);
    setNoticeAutoRefreshing(false);
  }, [currentSecUid, setNoticeAutoRefreshing, setNoticeItems, setNoticeLastUpdatedAt, setNoticeUnreadCount]);

  useEffect(() => {
    if (!cookieLoggedIn || !currentSecUid || refreshIntervalSeconds <= 0) return;
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, refreshIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [cookieLoggedIn, currentSecUid, poll, refreshIntervalSeconds]);
}
