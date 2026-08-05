/**
 * IM 自动化副作用入口。
 * 只处理调用方确认过的实时入站消息；历史补偿、同步提示和冷启动基线不能直接触发这里。
 */
import { autoReturnSharedMedia, sharedWorkReturnKey } from "@/lib/auto-return-shared-media";
import {
  getAiAutoSendDelayMs,
  normalizeAiSuggestions,
  readAiAutomationConfig,
  rememberAutomationKey,
  shouldAutomateText,
  waitForAiAutoSend,
} from "@/lib/ai-automation";
import {
  sendFriendMessage,
  suggestAiInteraction,
} from "@/lib/tauri";
import { useLogStore } from "@/stores/app-store";
import { buildPrivateMessageAiContext } from "./friends-chat-session";
import {
  rememberRecentAutoReturnMessageKeys,
  rememberRecentOutgoingText,
} from "./friends-im-identity";
import type {
  ChatSession,
  LocalChatMessage,
} from "./friends-status-types";

export async function maybeAutoReply(
  senderUid: string,
  displayName: string,
  incoming: LocalChatMessage,
  recentMessages: LocalChatMessage[],
  session: ChatSession | undefined,
  repliedKeys: Set<string>,
  recentOutgoingTexts: Map<string, number>,
  isCurrentAccount: () => boolean,
) {
  const key = incoming.id || `${senderUid}-${incoming.createdAt}-${incoming.text}`;
  if (!isCurrentAccount() || !key || repliedKeys.has(key)) return;
  const logger = useLogStore.getState();
  const incomingText = incoming.text || incoming.rawContent || "";

  try {
    const config = await readAiAutomationConfig();
    if (!isCurrentAccount()) return;
    if (!config?.enabled || !config.auto_monitor_friends) return;
    if (!config.auto_send_private_messages) return;
    if (!shouldAutomateText(incomingText, config, "private")) {
      logger.addLog(`好友私信未触发自动回复：未命中过滤规则 · 收到：${incomingText.slice(0, 80)}`, "info");
      return;
    }
    if (!rememberAutomationKey(repliedKeys, key)) return;

    logger.addLog(`好友私信触发自动回复：${displayName} · 收到：${incomingText.slice(0, 80)}`, "info");
    const context = buildPrivateMessageAiContext(session, recentMessages, displayName);
    const result = await suggestAiInteraction({
      target: "private_message",
      context,
      incoming_text: incomingText.slice(0, 360),
      author_name: displayName,
      tone: "warm",
      language: "zh-CN",
      max_suggestions: 3,
    });
    if (!isCurrentAccount()) return;
    const suggestions = normalizeAiSuggestions(result);
    if (!result.actions?.send_private_message || suggestions.length === 0) {
      logger.addLog("好友私信 AI 未返回可发送回复", "warning");
      return;
    }
    await waitForAiAutoSend(getAiAutoSendDelayMs(result.auto_send_delay_ms));
    if (!isCurrentAccount()) return;
    rememberRecentOutgoingText(recentOutgoingTexts, suggestions[0]);
    const sendResult = await sendFriendMessage({ toUserId: senderUid, content: suggestions[0] });
    if (!isCurrentAccount()) return;
    if (!sendResult.success) {
      throw new Error(sendResult.message || "自动回复发送失败");
    }
    logger.addLog(`好友私信自动回复成功：${displayName} · 发送：${suggestions[0].slice(0, 100)}`, "success");
  } catch (error) {
    logger.addLog(error instanceof Error ? error.message : "好友私信自动回复失败", "warning");
  }
}

export async function maybeAutoReturnShare(
  senderUid: string,
  incoming: LocalChatMessage,
  handledKeys: Set<string>,
  recentAutoReturnMessageKeys: Map<string, number>,
  isCurrentAccount: () => boolean,
) {
  const sharedWorkKey = sharedWorkReturnKey(incoming.rawContent || incoming.text);
  const key = sharedWorkKey
    ? `share:${senderUid}:${sharedWorkKey}`
    : `share:${incoming.id || `${senderUid}-${incoming.createdAt}`}`;
  if (!isCurrentAccount() || !rememberAutomationKey(handledKeys, key)) return;
  const logger = useLogStore.getState();
  try {
    const config = await readAiAutomationConfig();
    if (!isCurrentAccount()) return;
    if (!config?.enabled || !config.auto_monitor_friends || !config.auto_return_shared_media) return;
    const result = await autoReturnSharedMedia(senderUid, incoming.rawContent || incoming.text, config, {
      shouldContinue: isCurrentAccount,
      shouldHandleSharedWorkKey: (resolvedSharedWorkKey) => {
        const resolvedKey = `share:${senderUid}:${resolvedSharedWorkKey}`;
        if (resolvedKey === key) return true;
        return rememberAutomationKey(handledKeys, resolvedKey);
      },
      onRetry: (message) => logger.addLog(message, "warning"),
    });
    if (!isCurrentAccount()) return;
    if (!result.handled) {
      handledKeys.delete(key);
      if (result.skipped === "no_link") {
        logger.addLog("好友图集占位已收到，等待完整分享数据后再自动回传", "info");
      }
      return;
    }
    if (result.skipped === "duplicate") return;
    if (result.sharedWorkKey) {
      rememberAutomationKey(handledKeys, `share:${senderUid}:${result.sharedWorkKey}`);
    }
    rememberRecentAutoReturnMessageKeys(recentAutoReturnMessageKeys, result.sentMessageKeys);
    logger.addLog(result.sent > 0 ? `好友分享内容已自动回传：${result.sent} 个媒体` : `好友分享内容未回传：${result.skipped}`, result.sent > 0 ? "success" : "info");
  } catch (error) {
    logger.addLog(error instanceof Error ? `好友分享内容回传失败：${error.message}` : "好友分享内容回传失败", "warning");
  }
}
