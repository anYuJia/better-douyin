/**
 * 全局好友 IM 监听与恢复编排 hook。
 * 负责账号切换、实时事件、断线补偿、安全轮询、同步提示和静默基线调度；
 * 具体身份解析、落库、恢复目标解析和自动化副作用下沉到 friends-im-* 模块。
 */
import { useEffect, useRef } from "react";
import { useToastStore } from "@/components/ui/toast";
import {
  getAccounts,
  getImConnectionStatus,
  listenEvent,
} from "@/lib/tauri";
import {
  COOKIE_LOGIN_STATUS_EVENT,
  onCookieLoginStatus,
} from "@/lib/app-events";
import { isSharedWorkPayload } from "@/lib/auto-return-shared-media";
import {
  fallbackMessageText,
  messagePreviewText,
  numberField,
  stringField,
} from "@/components/friends/friends-status-utils";
import type { JsonRecord } from "@/components/friends/friends-status-types";
import {
  emitImAccountReady,
  onImAccountReady,
} from "@/components/friends/friends-im-events";
import { readCachedFriendDisplayName } from "@/components/friends/friends-local-storage";
import {
  maybeAutoReply,
  maybeAutoReturnShare,
} from "@/components/friends/friends-im-automation";
import {
  booleanValue,
  hasTrustedRecentServerTimestamp,
  incomingHistoryIdentity,
  isFreshRecoveryShare,
  isInitialSyncPayload,
  liveNeighborRecoveryTargetFromPayload,
  rememberHistoryIdentity,
  resolveMessageDirection,
  trustedServerTimestampMs,
  wasRecentlyAutoReturnedMessage,
  wasRecentlyAutoSent,
  type ImSyncHintTarget,
} from "@/components/friends/friends-im-identity";
import { persistIncomingMessage } from "@/components/friends/friends-im-persistence";
import { scanImHistoryPages } from "@/components/friends/friends-im-history-scan";
import {
  enqueueImSyncHintTargets,
  resolveFriendUidsForHintRecovery,
} from "@/components/friends/friends-im-recovery";
import {
  drainPendingIncomingPayloads,
  enqueuePendingIncomingPayload,
  type ImIncomingPayloadSource,
  type PendingIncomingPayload,
} from "@/components/friends/friends-im-pending-queue";
import {
  recoverFreshSharedHistoryForUid,
  recoverQueuedImSyncHintTargets,
} from "@/components/friends/friends-im-shared-recovery";

export { buildIncomingMessageStorageId } from "@/components/friends/friends-im-identity";

const IM_RECONCILE_SAFETY_WINDOW_MS = 45_000;
const MAX_IM_RECONCILE_PAGES = 16;
const IM_RECONCILE_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 15_000, 30_000];
const IM_WATCHDOG_INITIAL_DELAY_MS = 12_000;
const IM_WATCHDOG_INTERVAL_MS = 75_000;
const IM_WATCHDOG_CONNECTION_STABLE_MS = 8_000;
const IM_WATCHDOG_SAFETY_WINDOW_MS = 45_000;
const MAX_IM_WATCHDOG_PAGES = 3;
// Frontier 轻量同步包可能完全不携带可渲染的 MessageBody。
// 因此需要维护一个有界的身份静默基线，让认证历史兜底只把启动后出现的记录
// 放入未读和 Toast 处理。
const IM_HISTORY_BASELINE_PAGES = 3;
const IM_SYNC_HINT_DEBOUNCE_MS = 220;
const MAX_IM_SYNC_HINT_PAGES = 3;
const IM_LIVE_NEIGHBOR_RECOVERY_DEBOUNCE_MS = 5_000;

type ProcessIncomingOptions = {
  /** 非实时记录可以落库和展示，但触发副作用前必须经过额外保护。 */
  source: ImIncomingPayloadSource;
  accountEpoch: number;
  /** watchdog 记录必须晚于这个可信服务端时间边界。 */
  recoveryCutoff?: number;
  /**
   * 历史补偿出来的分享只有在实时传输信号明确指向该分享时才允许发送媒体。
   * 普通历史、启动同步批次和宽泛兜底扫描可以落库，但不能把旧分享自动回传。
   */
  allowAutoReturnShare?: boolean;
};

export function useGlobalFriendsIm() {
  const currentSecUidRef = useRef("");
  const currentUidRef = useRef("");
  const accountEpochRef = useRef(0);
  const accountLookupGenerationRef = useRef(0);
  const autoRepliedMessageIdsRef = useRef<Set<string>>(new Set());
  const autoReturnedSharedMessageIdsRef = useRef<Set<string>>(new Set());
  const recentOutgoingTextsRef = useRef<Map<string, number>>(new Map());
  const recentAutoReturnMessageKeysRef = useRef<Map<string, number>>(new Map());
  const pendingIncomingPayloadsRef = useRef<PendingIncomingPayload[]>([]);
  const pendingIncomingOverflowAtRef = useRef(0);
  const lastImStatusUpdatedAtRef = useRef(0);
  const imDisconnectedAtRef = useRef(0);
  const imReconcileInFlightRef = useRef(false);
  const reconcileRetryCountRef = useRef(0);
  const reconcileRetryTimerRef = useRef<number | undefined>(undefined);
  const imConnectedSinceRef = useRef(0);
  const imWatchdogInFlightEpochRef = useRef<number | null>(null);
  const imWatchdogLastPollAtRef = useRef(0);
  const imWatchdogTimerRef = useRef<number | undefined>(undefined);
  // 静默基线刻意独立于已渲染的聊天存储：
  // 它只用于判断哪些历史行早于当前渲染会话。
  // 这样无正文的 WS 同步提示可以补出新的分享卡片，同时不会把冷启动旧历史重放成未读通知。
  const imHistoryBaselineEpochRef = useRef(-1);
  const imHistoryBaselineReadyRef = useRef(false);
  const imHistoryBaselineInFlightEpochRef = useRef<number | null>(null);
  const imHistorySeenIdentitiesRef = useRef<Set<string>>(new Set());
  const imSyncHintPendingEpochRef = useRef<number | null>(null);
  const imSyncHintInFlightEpochRef = useRef<number | null>(null);
  const imSyncHintTimerRef = useRef<number | undefined>(undefined);
  const imSyncHintTargetsRef = useRef<ImSyncHintTarget[]>([]);
  const imLiveNeighborRecoveryInFlightRef = useRef<Set<string>>(new Set());
  const imLiveNeighborRecoveryLastAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let disposed = false;
    let unlistenCookieStatus: (() => void) | undefined;
    let removeCookieLoginStatus: (() => void) | undefined;
    const refreshCurrentAccount = async () => {
      const requestGeneration = ++accountLookupGenerationRef.current;
      try {
        const result = await getAccounts();
        if (!disposed && requestGeneration === accountLookupGenerationRef.current && result.success) {
          const nextSecUid = result.current_sec_uid || "";
          const previousSecUid = currentSecUidRef.current;
          const accountChanged = previousSecUid !== nextSecUid;
          if (accountChanged) {
            // 同步提示可能早于首次账号查询返回。
            // 这类提示属于正在初始化的监听器，只允许带入第一个确认账号；
            // 不能跨过真正的账号切换。
            const carryBootstrapSyncHint = !previousSecUid && imSyncHintPendingEpochRef.current !== null;
            accountEpochRef.current += 1;
            // 已知旧账号下排队的事件，绝不能刷入新账号的本地聊天命名空间。
            if (previousSecUid) pendingIncomingPayloadsRef.current = [];
            if (previousSecUid) pendingIncomingOverflowAtRef.current = 0;
            // 监听器状态属于即将被替换的桌面端会话。
            // 新账号应等待新监听器的快照/事件，不能把旧账号历史补偿进新命名空间。
            imDisconnectedAtRef.current = 0;
            lastImStatusUpdatedAtRef.current = 0;
            imConnectedSinceRef.current = 0;
            imWatchdogLastPollAtRef.current = 0;
            imWatchdogInFlightEpochRef.current = null;
            if (imWatchdogTimerRef.current !== undefined) {
              window.clearTimeout(imWatchdogTimerRef.current);
              imWatchdogTimerRef.current = undefined;
            }
            if (imSyncHintTimerRef.current !== undefined) {
              window.clearTimeout(imSyncHintTimerRef.current);
              imSyncHintTimerRef.current = undefined;
            }
            imHistoryBaselineEpochRef.current = -1;
            imHistoryBaselineReadyRef.current = false;
            imHistoryBaselineInFlightEpochRef.current = null;
            imHistorySeenIdentitiesRef.current.clear();
            imSyncHintInFlightEpochRef.current = null;
            imSyncHintPendingEpochRef.current = carryBootstrapSyncHint
              ? accountEpochRef.current
              : null;
            if (!carryBootstrapSyncHint) imSyncHintTargetsRef.current = [];
            autoRepliedMessageIdsRef.current.clear();
            autoReturnedSharedMessageIdsRef.current.clear();
            recentOutgoingTextsRef.current.clear();
            recentAutoReturnMessageKeysRef.current.clear();
          }
          currentSecUidRef.current = nextSecUid;
          const currentAccount = result.accounts?.find((account) => account.sec_uid === nextSecUid);
          currentUidRef.current = String(currentAccount?.uid || currentAccount?.user_id || "").trim();
          // Rust 监听器现在随桌面端启动，冷启动时可能早于这个异步账号查询。
          // 唤醒事件处理器，让短初始化窗口内安全排队的消息可以重放。
          emitImAccountReady({ accountEpoch: accountEpochRef.current, accountChanged });
        }
      } catch {
        // 账号查询短暂失败时保留现有命名空间。
      }
    };
    void refreshCurrentAccount();
    const handleCookieStatus = () => {
      void refreshCurrentAccount();
    };
    removeCookieLoginStatus = onCookieLoginStatus(handleCookieStatus);
    void listenEvent(COOKIE_LOGIN_STATUS_EVENT, handleCookieStatus).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlistenCookieStatus = cleanup;
    });
    return () => {
      disposed = true;
      removeCookieLoginStatus?.();
      unlistenCookieStatus?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenSyncHint: (() => void) | undefined;
    // 不要让静默基线在不可重放的 sync-hint 订阅建立前启动原生监听器。
    // 否则冷启动可能丢掉那条描述富分享卡片的唯一提示。
    let imSyncHintListenerReady = false;
    const isAccountActive = (accountEpoch: number, currentSecUid: string) =>
      !disposed &&
      accountEpochRef.current === accountEpoch &&
      currentSecUidRef.current === currentSecUid &&
      Boolean(currentSecUid);

    const processIncomingPayload = (payload: JsonRecord, options: ProcessIncomingOptions) => {
      if (disposed || !payload || typeof payload !== "object") return;
      const currentSecUid = currentSecUidRef.current;
      if (!currentSecUid) {
        pendingIncomingOverflowAtRef.current = enqueuePendingIncomingPayload(
          pendingIncomingPayloadsRef.current,
          payload,
          options.accountEpoch,
          options.source,
          pendingIncomingOverflowAtRef.current,
        );
        return;
      }
      if (!isAccountActive(options.accountEpoch, currentSecUid)) return;
      if (
        options.source === "watchdog"
        && !hasTrustedRecentServerTimestamp(payload, options.recoveryCutoff || 0)
      ) {
        // 不允许周期性安全网把冷启动历史页变成新的未读消息或通知。
        // 实时 WS 事件和明确的重连补偿各自保留独立路径。
        return;
      }
      const senderUid = stringField(payload, ["sender_uid", "senderUid"]);
      const currentUid = stringField(payload, ["current_uid", "currentUid"]);
      if (!currentUidRef.current && currentUid) {
        currentUidRef.current = currentUid;
      }
      const rawContent = stringField(payload, ["raw_content", "rawContent"]) || undefined;
      const text = stringField(payload, ["content", "text"]) || fallbackMessageText(rawContent);
      const messageDirection = resolveMessageDirection(payload, currentUidRef.current);
      const isOutgoing =
        messageDirection.outgoing ||
        wasRecentlyAutoSent(recentOutgoingTextsRef.current, text) ||
        wasRecentlyAutoReturnedMessage(recentAutoReturnMessageKeysRef.current, payload);
      // 静默基线构建期间，保留每个已成功观察到的传输身份。
      // 后续同步提示就不会把普通实时消息重新发现成一条新的历史行。
      rememberHistoryIdentity(imHistorySeenIdentitiesRef.current, incomingHistoryIdentity(payload));
      if (isOutgoing) {
        // 抖音会通过同一个 IM 监听器回传自己发送成功的消息。
        // 它们是正常的传输确认，不是好友入站消息，所以这里静默拦截。
        return;
      }
      const result = persistIncomingMessage(currentSecUid, payload);
      if (!result) return;
      const isSharedIncomingPayload = isSharedWorkPayload(result.message.rawContent || result.message.text);
      const liveNeighborTarget = isSharedIncomingPayload
        ? liveNeighborRecoveryTargetFromPayload(payload)
        : null;
      if (options.source === "live" && result.senderUid && liveNeighborTarget) {
        const lastRecoveredAt = imLiveNeighborRecoveryLastAtRef.current.get(result.senderUid) || 0;
        const now = Date.now();
        if (now - lastRecoveredAt >= IM_LIVE_NEIGHBOR_RECOVERY_DEBOUNCE_MS) {
          imLiveNeighborRecoveryLastAtRef.current.set(result.senderUid, now);
          void recoverFreshSharedHistoryForUid({
            ...sharedRecoveryContext(options.accountEpoch),
            uid: result.senderUid,
            reason: "live_neighbor",
            liveNeighborTarget,
          });
        }
      }
      const preview = messagePreviewText(result.message) || result.message.text;
      const displayName = readCachedFriendDisplayName(currentSecUid, result.senderUid);
      if (!result.upgradedExisting) {
        useToastStore.getState().toast(preview ? `收到新私信：${preview}` : "收到新私信", "info", "好友私信");
      }
      // 历史、同步提示和 203 批量包可能包含监听器没有实时看到的记录。
      // 它们可以进入本地未读状态；副作用只允许真正实时消息，或明确绑定
      // 到实时分享信号的历史补偿记录触发。
      const isGenuineLiveMessage = options.source === "live"
        && imConnectedSinceRef.current > 0
        && result.message.createdAt >= imConnectedSinceRef.current - 3000;

      const canAutoReply = isGenuineLiveMessage;
      const canAutoReturnShare = isGenuineLiveMessage || options.allowAutoReturnShare === true;
      const active = () => isAccountActive(options.accountEpoch, currentSecUid);
      if (isSharedIncomingPayload) {
        if (canAutoReturnShare) {
          void maybeAutoReturnShare(
            result.senderUid,
            result.message,
            autoReturnedSharedMessageIdsRef.current,
            recentAutoReturnMessageKeysRef.current,
            active,
          );
        }
        return;
      }
      if (!canAutoReply) return;
      void maybeAutoReply(
        result.senderUid,
        displayName,
        result.message,
        result.nextMessages[result.conversationKey] || [result.message],
        result.session,
        autoRepliedMessageIdsRef.current,
        recentOutgoingTextsRef.current,
        active,
      );
    };

    const sharedRecoveryContext = (requestedEpoch: number) => ({
      currentSecUid: currentSecUidRef.current,
      currentUid: currentUidRef.current,
      requestedEpoch,
      seenIdentities: imHistorySeenIdentitiesRef.current,
      inFlightKeys: imLiveNeighborRecoveryInFlightRef.current,
      isAccountActive,
      processPayload: (payload: JsonRecord, extraOptions?: Pick<ProcessIncomingOptions, "allowAutoReturnShare">) => {
        processIncomingPayload(payload, {
          source: "hint",
          accountEpoch: requestedEpoch,
          allowAutoReturnShare: extraOptions?.allowAutoReturnShare,
        });
      },
    });

    const flushPendingIncomingPayloads = () => {
      if (disposed || !currentSecUidRef.current) return;
      const pending = drainPendingIncomingPayloads(pendingIncomingPayloadsRef.current);
      const accountEpoch = accountEpochRef.current;
      for (const item of pending) {
        // epoch 为 0 表示账号查询完成前的短冷启动窗口。
        // 任何非 0 epoch 都必须精确匹配当前账号。
        if (item.accountEpoch && item.accountEpoch !== accountEpoch) continue;
        processIncomingPayload(item.payload, { source: item.source, accountEpoch });
      }
    };

    const scheduleReconcileRetry = () => {
      if (disposed || reconcileRetryTimerRef.current !== undefined || !imDisconnectedAtRef.current) return;
      const index = Math.min(reconcileRetryCountRef.current, IM_RECONCILE_RETRY_DELAYS_MS.length - 1);
      const delay = IM_RECONCILE_RETRY_DELAYS_MS[index];
      reconcileRetryCountRef.current += 1;
      reconcileRetryTimerRef.current = window.setTimeout(() => {
        reconcileRetryTimerRef.current = undefined;
        void reconcileRecentMessages(accountEpochRef.current);
      }, delay);
    };

    const reconcileRecentMessages = async (requestedEpoch = accountEpochRef.current) => {
      const disconnectedAt = imDisconnectedAtRef.current;
      if (disposed || !disconnectedAt || imReconcileInFlightRef.current || requestedEpoch !== accountEpochRef.current) return;
      if (!currentSecUidRef.current) {
        return;
      }
      const currentSecUid = currentSecUidRef.current;
      imReconcileInFlightRef.current = true;
      let reconciled = false;
      try {
        // 后端会在 25 秒 ping + 10 秒 Pong 超时后识别半开 socket。
        // 补偿窗口要覆盖记录断线前的这段时间，避免最后一条实时事件和重连历史拉取之间出现盲区。
        const cutoff = Math.max(0, disconnectedAt - IM_RECONCILE_SAFETY_WINDOW_MS);
        let coveredBreakpoint = false;
        const scan = await scanImHistoryPages({
          maxPages: MAX_IM_RECONCILE_PAGES,
          errorMessage: "获取断线期间私信失败",
          shouldContinue: () => isAccountActive(requestedEpoch, currentSecUid),
          onPage: ({ messages, hasMore }) => {
            let oldestTimestamp = Number.POSITIVE_INFINITY;
            let foundTrustedTimestamp = false;
            for (const payload of messages) {
              const serverCreatedAt = trustedServerTimestampMs(payload);
              if (serverCreatedAt > 0) {
                foundTrustedTimestamp = true;
                oldestTimestamp = Math.min(oldestTimestamp, serverCreatedAt);
              }
              if (hasTrustedRecentServerTimestamp(payload, cutoff)) {
                processIncomingPayload(payload, {
                  source: "history",
                  accountEpoch: requestedEpoch,
                  recoveryCutoff: cutoff,
                });
              }
            }

            // 缺少显式服务端时间戳的旧适配数据，不能安全重放进未读状态。
            // 这类页面视为已覆盖，避免无限重试并把旧历史变成 Toast。
            if (oldestTimestamp <= cutoff || messages.length === 0 || !hasMore || !foundTrustedTimestamp) {
              coveredBreakpoint = true;
              return "stop";
            }
            return "continue";
          },
        });
        if (scan.aborted) return;
        reconciled = coveredBreakpoint;
      } catch {
        // 保留断点；历史接口短暂失败时，有限指数重试比直接宣告成功更安全。
      } finally {
        if (reconciled && imDisconnectedAtRef.current === disconnectedAt && isAccountActive(requestedEpoch, currentSecUid)) {
          imDisconnectedAtRef.current = 0;
          reconcileRetryCountRef.current = 0;
        } else if (!disposed && imDisconnectedAtRef.current === disconnectedAt) {
          scheduleReconcileRetry();
        }
        imReconcileInFlightRef.current = false;
      }
    };

    const clearImWatchdogTimer = () => {
      if (imWatchdogTimerRef.current === undefined) return;
      window.clearTimeout(imWatchdogTimerRef.current);
      imWatchdogTimerRef.current = undefined;
    };

    const isWatchdogConnectionActive = (requestedEpoch: number, currentSecUid: string) =>
      isAccountActive(requestedEpoch, currentSecUid) && imConnectedSinceRef.current > 0;

    const scheduleImWatchdog = (requestedEpoch = accountEpochRef.current) => {
      if (disposed || imWatchdogTimerRef.current !== undefined || requestedEpoch !== accountEpochRef.current) return;
      const currentSecUid = currentSecUidRef.current;
      const connectedSince = imConnectedSinceRef.current;
      if (!currentSecUid || !connectedSince || !isWatchdogConnectionActive(requestedEpoch, currentSecUid)) return;
      const connectedFor = Math.max(0, Date.now() - connectedSince);
      const delay = imWatchdogLastPollAtRef.current > 0
        ? IM_WATCHDOG_INTERVAL_MS
        : Math.max(IM_WATCHDOG_INITIAL_DELAY_MS, IM_WATCHDOG_CONNECTION_STABLE_MS - connectedFor);
      imWatchdogTimerRef.current = window.setTimeout(() => {
        imWatchdogTimerRef.current = undefined;
        void runImHistoryWatchdog(requestedEpoch);
      }, delay);
    };

    const runImHistoryWatchdog = async (requestedEpoch = accountEpochRef.current) => {
      const currentSecUid = currentSecUidRef.current;
      const connectedSince = imConnectedSinceRef.current;
      if (!currentSecUid || !connectedSince || !isWatchdogConnectionActive(requestedEpoch, currentSecUid)) return;
      if (Date.now() - connectedSince < IM_WATCHDOG_CONNECTION_STABLE_MS) {
        scheduleImWatchdog(requestedEpoch);
        return;
      }
      if (imWatchdogInFlightEpochRef.current === requestedEpoch) {
        scheduleImWatchdog(requestedEpoch);
        return;
      }

      // 首次拉取刻意从观察到的连接时间附近开始，而不是从任意历史 cursor 开始。
      // 后续轮询会和上次窗口轻微重叠，避免迟到历史页造成缺口；
      // 本地已持久化的服务端 ID 会自然折叠这段重叠。
      const cutoff = Math.max(
        0,
        (imWatchdogLastPollAtRef.current || connectedSince) - IM_WATCHDOG_SAFETY_WINDOW_MS,
      );
      imWatchdogInFlightEpochRef.current = requestedEpoch;
      let completed = false;
      try {
        const scan = await scanImHistoryPages({
          maxPages: MAX_IM_WATCHDOG_PAGES,
          errorMessage: "获取 IM 安全补偿消息失败",
          shouldContinue: () => isWatchdogConnectionActive(requestedEpoch, currentSecUid),
          onPage: ({ messages, hasMore }) => {
            completed = true;
            let oldestTimestamp = Number.POSITIVE_INFINITY;
            let foundTrustedTimestamp = false;
            for (const payload of messages) {
              const serverCreatedAt = trustedServerTimestampMs(payload);
              if (serverCreatedAt > 0) {
                foundTrustedTimestamp = true;
                oldestTimestamp = Math.min(oldestTimestamp, serverCreatedAt);
              }
              if (hasTrustedRecentServerTimestamp(payload, cutoff)) {
                processIncomingPayload(payload, {
                  source: "watchdog",
                  accountEpoch: requestedEpoch,
                  recoveryCutoff: cutoff,
                });
              }
            }
            return oldestTimestamp <= cutoff || messages.length === 0 || !hasMore || !foundTrustedTimestamp
              ? "stop"
              : "continue";
          },
        });
        if (scan.aborted) return;
      } catch {
        // 这是刻意保持安静的安全网。实时监听器仍是权威路径；
        // watchdog 失败不能刷屏自动化日志。
      } finally {
        if (imWatchdogInFlightEpochRef.current === requestedEpoch) {
          imWatchdogInFlightEpochRef.current = null;
          if (completed && isWatchdogConnectionActive(requestedEpoch, currentSecUid)) {
            imWatchdogLastPollAtRef.current = Date.now();
          }
        }
        if (isWatchdogConnectionActive(requestedEpoch, currentSecUid)) {
          scheduleImWatchdog(requestedEpoch);
        }
      }
    };

    /**
     * 构建近期全局历史的静默快照。
     * Frontier 同步链路对部分富分享不会携带正文，后续 hint 只能知道“有东西变了”。
     * 这里先捕获身份，避免恢复拉取在启动时把旧历史重放进未读和通知。
     */
    const establishImHistoryBaseline = async (requestedEpoch = accountEpochRef.current) => {
      const currentSecUid = currentSecUidRef.current;
      if (!isAccountActive(requestedEpoch, currentSecUid)) return false;
      if (
        imHistoryBaselineReadyRef.current
        && imHistoryBaselineEpochRef.current === requestedEpoch
      ) return true;
      if (imHistoryBaselineInFlightEpochRef.current === requestedEpoch) return false;

      imHistoryBaselineInFlightEpochRef.current = requestedEpoch;
      const captured = new Set<string>();
      const identitiesBeforeBaseline = new Set(imHistorySeenIdentitiesRef.current);
      const recoverPendingHintShares = imSyncHintPendingEpochRef.current === requestedEpoch;
      const hintedBaselinePayloads: JsonRecord[] = [];
      // 实时消息可能和首次历史拉取并发。
      // 提交快照时要保留渲染器已经观察到的所有身份。
      for (const identity of imHistorySeenIdentitiesRef.current) {
        rememberHistoryIdentity(captured, identity);
      }
      let completed = false;
      try {
        const scan = await scanImHistoryPages({
          maxPages: IM_HISTORY_BASELINE_PAGES,
          errorMessage: "获取 IM 历史基线失败",
          shouldContinue: () => isAccountActive(requestedEpoch, currentSecUid),
          onPage: ({ messages }) => {
            for (const payload of messages) {
              const identity = incomingHistoryIdentity(payload);
              if (
                recoverPendingHintShares
                && identity
                && !identitiesBeforeBaseline.has(identity)
              ) {
                const rawContent = stringField(payload, ["raw_content", "rawContent"]) || undefined;
                const text = stringField(payload, ["content", "text"]) || fallbackMessageText(rawContent);
                if (isSharedWorkPayload(rawContent || text) && isFreshRecoveryShare(payload)) {
                  hintedBaselinePayloads.push(payload);
                }
              }
              rememberHistoryIdentity(captured, identity);
            }
            return messages.length === 0 ? "stop" : "continue";
          },
        });
        if (scan.aborted) return false;
        completed = true;
      } catch {
        // 没有完整初始快照时，任何 UI 副作用都不安全。
        // 后续状态变化或同步提示会再次尝试。
      } finally {
        if (imHistoryBaselineInFlightEpochRef.current === requestedEpoch) {
          imHistoryBaselineInFlightEpochRef.current = null;
        }
      }

      if (!completed || !isAccountActive(requestedEpoch, currentSecUid)) return false;
      const merged = new Set<string>();
      for (const identity of imHistorySeenIdentitiesRef.current) {
        rememberHistoryIdentity(merged, identity);
      }
      for (const identity of captured) {
        rememberHistoryIdentity(merged, identity);
      }
      imHistorySeenIdentitiesRef.current = merged;
      imHistoryBaselineEpochRef.current = requestedEpoch;
      imHistoryBaselineReadyRef.current = true;
      for (const payload of hintedBaselinePayloads) {
        if (!isAccountActive(requestedEpoch, currentSecUid)) return false;
        processIncomingPayload(payload, {
          source: "hint",
          accountEpoch: requestedEpoch,
        });
      }
      if (imSyncHintPendingEpochRef.current === requestedEpoch) {
        scheduleImSyncHint(requestedEpoch);
      }
      return true;
    };

    const clearImSyncHintTimer = () => {
      if (imSyncHintTimerRef.current === undefined) return;
      window.clearTimeout(imSyncHintTimerRef.current);
      imSyncHintTimerRef.current = undefined;
    };

    /**
     * hint 不携带私信正文。
     * 一批 hint 会先合并处理：优先恢复后端安全暴露的发送者/会话目标，
     * 再回退到全局历史，并且只把静默基线中不存在的记录送入 `processIncomingPayload`。
     */
    const runImSyncHintHistory = async (requestedEpoch = accountEpochRef.current) => {
      const currentSecUid = currentSecUidRef.current;
      if (!isAccountActive(requestedEpoch, currentSecUid)) return;
      if (
        !imHistoryBaselineReadyRef.current
        || imHistoryBaselineEpochRef.current !== requestedEpoch
      ) {
        if (
          imSyncHintTargetsRef.current.length > 0
          && imSyncHintInFlightEpochRef.current !== requestedEpoch
        ) {
          imSyncHintInFlightEpochRef.current = requestedEpoch;
          try {
            await recoverQueuedImSyncHintTargets({
              ...sharedRecoveryContext(requestedEpoch),
              targetQueue: imSyncHintTargetsRef.current,
            });
          } finally {
            if (imSyncHintInFlightEpochRef.current === requestedEpoch) {
              imSyncHintInFlightEpochRef.current = null;
            }
          }
        }
        void establishImHistoryBaseline(requestedEpoch);
        return;
      }
      if (imSyncHintInFlightEpochRef.current === requestedEpoch) return;

      // 消费触发本轮运行的 hint。
      // 如果请求进行中又有新 hint 到达，它会重新填充这个 ref，
      // 并在当前历史页完成后安排最后一轮合并处理。
      if (imSyncHintPendingEpochRef.current === requestedEpoch) {
        imSyncHintPendingEpochRef.current = null;
      }
      imSyncHintInFlightEpochRef.current = requestedEpoch;
      try {
        let recoveredMessages = await recoverQueuedImSyncHintTargets({
          ...sharedRecoveryContext(requestedEpoch),
          targetQueue: imSyncHintTargetsRef.current,
        });
        const scan = await scanImHistoryPages({
          maxPages: MAX_IM_SYNC_HINT_PAGES,
          errorMessage: "获取 IM 同步消息失败",
          shouldContinue: () => isAccountActive(requestedEpoch, currentSecUid),
          onPage: ({ messages, hasMore }) => {
            let pageAlreadyKnown = false;
            for (const payload of messages) {
              const identity = incomingHistoryIdentity(payload);
              if (imHistorySeenIdentitiesRef.current.has(identity)) {
                pageAlreadyKnown = true;
                continue;
              }
              // 先标记再触发副作用，避免重叠 hint 在这条记录落库期间发起第二次下载/回复。
              rememberHistoryIdentity(imHistorySeenIdentitiesRef.current, identity);
              processIncomingPayload(payload, {
                source: "hint",
                accountEpoch: requestedEpoch,
              });
              recoveredMessages += 1;
            }

            // 近期用户历史按新到旧排序。
            // 一旦页面触达启动基线，更旧页面就不可能再补出新 hint 指向的卡片。
            return messages.length === 0 || pageAlreadyKnown || !hasMore
              ? "stop"
              : "continue";
          },
        });
        if (scan.aborted) return;
        if (recoveredMessages === 0) {
          const candidateUids = await resolveFriendUidsForHintRecovery(currentSecUid, currentUidRef.current);
          for (const uid of candidateUids) {
            recoveredMessages += await recoverFreshSharedHistoryForUid({
              ...sharedRecoveryContext(requestedEpoch),
              uid,
              reason: "sync_hint",
            });
          }
        }
      } catch {
        // 下一条同步提示可以重试这条静默恢复路径。
        // 内部安全网失败不弹错误 Toast。
      } finally {
        if (imSyncHintInFlightEpochRef.current === requestedEpoch) {
          imSyncHintInFlightEpochRef.current = null;
        }
        if (
          imSyncHintPendingEpochRef.current === requestedEpoch
          && isAccountActive(requestedEpoch, currentSecUid)
        ) {
          scheduleImSyncHint(requestedEpoch);
        }
      }
    };

    const scheduleImSyncHint = (requestedEpoch = accountEpochRef.current) => {
      if (disposed || requestedEpoch !== accountEpochRef.current) return;
      imSyncHintPendingEpochRef.current = requestedEpoch;
      const currentSecUid = currentSecUidRef.current;
      if (!isAccountActive(requestedEpoch, currentSecUid)) return;
      if (
        !imHistoryBaselineReadyRef.current
        || imHistoryBaselineEpochRef.current !== requestedEpoch
      ) {
        if (
          imSyncHintTargetsRef.current.length > 0
          && imSyncHintTimerRef.current === undefined
          && imSyncHintInFlightEpochRef.current !== requestedEpoch
        ) {
          imSyncHintTimerRef.current = window.setTimeout(() => {
            imSyncHintTimerRef.current = undefined;
            void runImSyncHintHistory(requestedEpoch);
          }, IM_SYNC_HINT_DEBOUNCE_MS);
        }
        void establishImHistoryBaseline(requestedEpoch);
        return;
      }
      if (imSyncHintTimerRef.current !== undefined || imSyncHintInFlightEpochRef.current === requestedEpoch) return;
      imSyncHintTimerRef.current = window.setTimeout(() => {
        imSyncHintTimerRef.current = undefined;
        void runImSyncHintHistory(requestedEpoch);
      }, IM_SYNC_HINT_DEBOUNCE_MS);
    };

    const markReconciliationRequired = (at: number) => {
      const safeAt = at > 0 ? at : Date.now();
      imDisconnectedAtRef.current = imDisconnectedAtRef.current
        ? Math.min(imDisconnectedAtRef.current, safeAt)
        : safeAt;
    };
    const handleAccountReady = () => {
      flushPendingIncomingPayloads();
      if (imSyncHintListenerReady) void establishImHistoryBaseline(accountEpochRef.current);
      if (pendingIncomingOverflowAtRef.current) {
        markReconciliationRequired(pendingIncomingOverflowAtRef.current);
        pendingIncomingOverflowAtRef.current = 0;
      }
      if (imDisconnectedAtRef.current) void reconcileRecentMessages(accountEpochRef.current);
      scheduleImWatchdog(accountEpochRef.current);
    };
    const handleImStatus = (payload: JsonRecord) => {
      if (disposed || !payload || typeof payload !== "object") return;
      const connected = booleanValue(payload.connected) === true;
      const updatedAt = numberField(payload, ["updated_at", "updatedAt"]) || Date.now();
      if (updatedAt < lastImStatusUpdatedAtRef.current) return;
      lastImStatusUpdatedAtRef.current = updatedAt;
      if (!connected) {
        // 监听器首次成功建连前会先发出初始 “connecting” 状态。
        // 这不代表存在丢消息区间；只有已建立连接后的断开才需要补偿。
        if (imConnectedSinceRef.current) {
          markReconciliationRequired(updatedAt);
          imConnectedSinceRef.current = 0;
          clearImWatchdogTimer();
        }
        return;
      }
      if (!imConnectedSinceRef.current) {
        // 使用本地观察时间，而不是可能陈旧的快照时间。
        // 新挂载的渲染器不能仅因 socket 早已连接，就重放数小时历史。
        imConnectedSinceRef.current = Date.now();
        imWatchdogLastPollAtRef.current = 0;
      }
      if (imSyncHintListenerReady) void establishImHistoryBaseline(accountEpochRef.current);
      const shouldReconcile = imDisconnectedAtRef.current > 0;
      if (shouldReconcile) void reconcileRecentMessages(accountEpochRef.current);
      scheduleImWatchdog(accountEpochRef.current);
    };
    const removeImAccountReady = onImAccountReady(handleAccountReady);
    // 覆盖 getAccounts 早于这个 listener effect 注册完成的情况。
    handleAccountReady();
    void listenEvent<JsonRecord>("im-message", (payload) => {
      processIncomingPayload(payload, {
        source: isInitialSyncPayload(payload) ? "initial_sync" : "live",
        accountEpoch: accountEpochRef.current,
      });
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    void listenEvent<JsonRecord>("im-sync-hint", (payload) => {
      // 这个信号刻意不携带私信正文。
      // 后端能安全暴露发送者/会话 ID 时，也只用于定向认证历史恢复。
      enqueueImSyncHintTargets(imSyncHintTargetsRef.current, payload || {}, currentUidRef.current);
      scheduleImSyncHint(accountEpochRef.current);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else {
        unlistenSyncHint = cleanup;
        imSyncHintListenerReady = true;
        void establishImHistoryBaseline(accountEpochRef.current);
      }
    });
    void listenEvent<JsonRecord>("im-status", handleImStatus).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlistenStatus = cleanup;
      // 渲染器晚订阅时事件不会重放。
      // 必须先注册 listener 再读取后端快照，避免状态迁移落在两步之间。
      void getImConnectionStatus()
        .then((snapshot) => {
          if (!disposed && snapshot?.success) handleImStatus(snapshot as unknown as JsonRecord);
        })
        .catch(() => undefined);
    });
    return () => {
      disposed = true;
      if (reconcileRetryTimerRef.current !== undefined) {
        window.clearTimeout(reconcileRetryTimerRef.current);
        reconcileRetryTimerRef.current = undefined;
      }
      clearImWatchdogTimer();
      clearImSyncHintTimer();
      removeImAccountReady();
      unlisten?.();
      unlistenStatus?.();
      unlistenSyncHint?.();
    };
  }, []);
}
