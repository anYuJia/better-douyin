import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Check,
  Clock3,
  Copy,
  Download,
  Filter,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Star,
  Square,
  ThumbsUp,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SectionSurface } from "@/components/common/surface";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppStore, useLogStore } from "@/stores/app-store";
import {
  CREATOR_MONITOR_MAX_INTERVAL_MINUTES,
  CREATOR_MONITOR_MIN_INTERVAL_MINUTES,
  getConfig,
  getCreatorMonitor,
  listenEvent,
  normalizeCreatorMonitorConfig,
  runCreatorMonitorNow,
  saveConfig,
  saveCreatorMonitor,
  type AiInteractionConfig,
  type CreatorMonitorConfig,
  type CreatorMonitorEvent,
  type CreatorMonitorStatus,
  type CreatorMonitorTarget,
} from "@/lib/tauri";
import { DEFAULT_AI_AUTOMATION, normalizeAiAutomationConfig } from "@/lib/ai-automation";
import { cn } from "@/lib/utils";
import { AutomationSettingsDialog } from "./automation-settings-dialog";

type MonitorSource = "all" | "feed" | "friends" | "notices" | "comments" | "creators";
type AutomationLogEntry = {
  id: number;
  message: string;
  type: "info" | "success" | "error" | "warning";
  timestamp: number;
  source: MonitorSource;
};

const SOURCE_LABELS: Record<MonitorSource, string> = {
  all: "全部",
  feed: "推荐流",
  friends: "好友",
  notices: "通知",
  comments: "评论区",
  creators: "作品监控",
};

const SOURCE_BADGE_CLASS: Record<MonitorSource, string> = {
  all: "border-border bg-surface-raised text-text-muted",
  feed: "border-accent/20 bg-accent-soft text-accent",
  friends: "border-info/20 bg-info-soft text-info",
  notices: "border-warning/20 bg-warning-soft text-warning",
  comments: "border-success/20 bg-success-soft text-success",
  creators: "border-accent/25 bg-accent/10 text-accent",
};

const LOG_LEVEL_META = {
  info: {
    label: "信息",
    dotClass: "bg-info",
    badgeClass: "border-info/20 bg-info-soft text-info",
    itemClass: "border-border bg-surface/35",
  },
  success: {
    label: "成功",
    dotClass: "bg-success",
    badgeClass: "border-success/20 bg-success-soft text-success",
    itemClass: "border-success/15 bg-success-soft/20",
  },
  warning: {
    label: "提醒",
    dotClass: "bg-warning",
    badgeClass: "border-warning/20 bg-warning-soft text-warning",
    itemClass: "border-warning/15 bg-warning-soft/20",
  },
  error: {
    label: "错误",
    dotClass: "bg-danger",
    badgeClass: "border-danger/20 bg-danger-soft text-danger",
    itemClass: "border-danger/15 bg-danger-soft/20",
  },
};

const DEFAULT_AI_CONFIG: AiInteractionConfig = {
  enabled: false,
  provider: "openai_compatible",
  api_base: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  system_prompt: "",
  user_prompt: "",
  auto_send_comments: false,
  auto_send_private_messages: false,
  auto_like: false,
  auto_collect: false,
  auto_send_delay_ms: 0,
  auto_send_max_chars: 180,
  auto_require_context: true,
  ...DEFAULT_AI_AUTOMATION,
};

const DEFAULT_CREATOR_MONITOR_CONFIG: CreatorMonitorConfig = {
  enabled: false,
  interval_minutes: 60,
  fetch_count: 20,
  max_new_downloads_per_check: 10,
  targets: [],
};

const DEFAULT_CREATOR_MONITOR_STATUS: CreatorMonitorStatus = {
  running: false,
  message: "创作者作品监控未启动",
  last_run_at: 0,
  next_run_at: 0,
};

function formatTime(timestamp?: number) {
  if (!timestamp) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatUnixDateTime(timestamp?: number) {
  if (!timestamp) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp * 1000);
}

function formatCreatorInterval(minutes?: number) {
  const value = Number(minutes || 0);
  if (value >= 1440) return "每天一次";
  if (value >= 60 && value % 60 === 0) return `${value / 60} 小时一次`;
  return `${value || CREATOR_MONITOR_MIN_INTERVAL_MINUTES} 分钟一次`;
}

function numberInputValue(value: number | undefined) {
  return Number.isFinite(Number(value)) ? String(value) : "";
}

function splitKeywords(value?: string) {
  return String(value || "")
    .split(/[,，\n\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function classifyLog(message: string): MonitorSource | null {
  if (/作品监控|创作者|新作品|用户监控/.test(message)) return "creators";
  if (/推荐流|后台推荐|视频自动处理/.test(message)) return "feed";
  if (/好友私信|私信/.test(message)) return "friends";
  if (/通知|关注|回关/.test(message)) return "notices";
  if (/评论|跟评/.test(message)) return "comments";
  if (/自动|监测|监控/.test(message)) return "all";
  return null;
}

function isAutomationLog(message: string) {
  return Boolean(classifyLog(message)) || /自动处理|自动回复|自动发送|后台/.test(message);
}

function logLevelMeta(type: string) {
  return LOG_LEVEL_META[type as keyof typeof LOG_LEVEL_META] || LOG_LEVEL_META.info;
}

function splitLogMessage(message: string) {
  const text = String(message || "").trim();
  const parts = text.split(/(?:：|: | · )/).map((item) => item.trim()).filter(Boolean);
  if (parts.length <= 1) return { title: text, details: [] as string[] };
  const details = parts.slice(1);
  return {
    title: parts[0],
    details: details.length > 3 ? [...details.slice(0, 2), details.slice(2).join(" · ")] : details,
  };
}

function isRetryableAutomationError(reason: string) {
  return /error decoding response body|response body|timeout|timed out|network|fetch|connection reset|socket hang up|econnreset|etimedout|econnaborted|502|503|504|429|temporarily|temporary|临时|网络波动|接口返回格式异常|响应解析失败/i.test(reason);
}

function formatAutomationErrorDetail(error: string) {
  const text = String(error || "").trim();
  const sendFailed = text.match(/^(发送.+?失败)[:：]\s*(.+)$/);
  const operation = sendFailed?.[1] || "媒体回传";
  const reason = sendFailed?.[2] || text;
  const retryable = isRetryableAutomationError(reason);
  const retried = reason.match(/已重试\s*(\d+)\s*次/);
  const retrySuffix = retried ? `，已自动重试 ${retried[1]} 次` : "，通常可以重试";
  const friendlyReason = /error decoding response body|response body|接口返回格式异常|响应解析失败/i.test(reason)
    ? `平台响应解析失败${retrySuffix}`
    : retryable
      ? retried
        ? reason
        : `${reason}，通常可以重试`
      : reason;
  const suggestion =
    retryable && retried
      ? "建议：系统已自动重试过；如果仍连续失败，再刷新 Cookie 或重新打开会话"
      : retryable
        ? "建议：稍后重试发送；如果连续失败，再刷新 Cookie 或重新打开会话"
        : "建议：检查配置、Cookie 或媒体有效性后再处理";
  return {
    operation,
    friendlyReason,
    retryable,
    retried: Boolean(retried),
    details: [`操作：${operation}`, `原因：${friendlyReason}`, suggestion, `原始错误：${text}`],
  };
}

function presentAutomationLog(message: string, source: MonitorSource) {
  const text = String(message || "").trim();
  const parsed = splitLogMessage(text);
  const base = {
    icon: source === "friends" ? Users : source === "notices" ? Bell : source === "comments" ? MessageSquare : source === "feed" ? RefreshCw : source === "creators" ? Download : Activity,
    title: parsed.title,
    subtitle: "后台监控记录",
    details: parsed.details,
    steps: [] as string[],
  };

  const shareReturned = text.match(/^好友分享内容已自动回传：(.+)$/);
  if (shareReturned) {
    return {
      icon: RefreshCw,
      title: "已自动回传分享内容",
      subtitle: "好友发来的分享内容已处理并回传到聊天",
      details: [shareReturned[1], "发送状态：完成"],
      steps: ["识别分享", "下载媒体", "回传完成"],
    };
  }

  const replySuccess = text.match(/^好友私信自动回复成功：(.+?) · 发送：(.+)$/);
  if (replySuccess) {
    return {
      icon: Send,
      title: "已自动回复好友私信",
      subtitle: `给 ${replySuccess[1]} 发送了自动回复`,
      details: [`好友：${replySuccess[1]}`, `回复：${replySuccess[2]}`],
      steps: ["收到消息", "生成回复", "发送完成"],
    };
  }

  const replyTriggered = text.match(/^好友私信触发自动回复：(.+?) · 收到：(.+)$/);
  if (replyTriggered) {
    return {
      icon: MessageSquare,
      title: "收到好友私信，准备自动回复",
      subtitle: `已命中过滤规则，正在为 ${replyTriggered[1]} 生成回复`,
      details: [`好友：${replyTriggered[1]}`, `收到：${replyTriggered[2]}`],
      steps: ["收到消息", "命中规则", "等待发送"],
    };
  }

  const replySkipped = text.match(/^好友私信未触发自动回复：(.+?) · 收到：(.+)$/);
  if (replySkipped) {
    return {
      icon: ShieldCheck,
      title: "好友私信已跳过自动回复",
      subtitle: replySkipped[1],
      details: [`收到：${replySkipped[2]}`],
      steps: ["收到消息", "规则检查", "未发送"],
    };
  }

  const followBack = text.match(/^收到关注自动回关成功：(.+)$/);
  if (followBack) {
    return {
      icon: UserPlus,
      title: "已自动回关新粉丝",
      subtitle: `收到关注后，已关注 ${followBack[1]}`,
      details: [`粉丝：${followBack[1]}`],
      steps: ["收到关注", "执行回关", "回关完成"],
    };
  }

  const noticeReply = text.match(/^通知自动回复成功：(.+)$/);
  if (noticeReply) {
    return {
      icon: Send,
      title: "已自动回复通知评论",
      subtitle: `已回复 ${noticeReply[1]} 的评论通知`,
      details: [`对象：${noticeReply[1]}`],
      steps: ["收到通知", "生成回复", "回复完成"],
    };
  }

  const shareRecovered = text.match(/^好友分享内容已通过(.+?)同步：(.+)$/);
  if (shareRecovered) {
    return {
      icon: RefreshCw,
      title: "已补偿同步好友分享内容",
      subtitle: `${shareRecovered[1]}同步完成`,
      details: [shareRecovered[2]],
      steps: ["发现缺口", "补偿同步", "等待回传"],
    };
  }

  const shareRetrying = text.match(/^好友分享内容回传重试：(.+?) · 第 (\d+)\/(\d+) 次 · (.+)$/);
  if (shareRetrying) {
    return {
      icon: Clock3,
      title: "正在自动重试分享内容回传",
      subtitle: `${shareRetrying[1]} · 第 ${shareRetrying[2]}/${shareRetrying[3]} 次`,
      details: [`操作：${shareRetrying[1]}`, `重试进度：第 ${shareRetrying[2]} / ${shareRetrying[3]} 次`, `原因：${shareRetrying[4]}`],
      retryable: true,
      steps: ["识别临时错误", "等待重试", "自动再次发送"],
    };
  }

  const shareFailed = text.match(/^好友分享内容回传失败：(.+)$/);
  if (shareFailed) {
    const error = formatAutomationErrorDetail(shareFailed[1]);
    return {
      icon: RefreshCw,
      title: error.operation,
      subtitle: error.friendlyReason,
      details: error.details,
      retryable: error.retryable,
      steps: ["识别分享", error.retried ? "已自动重试" : "准备媒体", error.retryable ? "等待处理" : "发送失败"],
    };
  }

  if (/好友私信已收到，自动回复未执行/.test(text)) {
    return {
      icon: MessageSquare,
      title: "收到好友私信，未执行自动回复",
      subtitle: text.replace(/^好友私信已收到，自动回复未执行：?/, ""),
      details: [],
      steps: ["收到消息", "配置检查", "未发送"],
    };
  }

  return base;
}

async function copyTextToClipboard(text: string) {
  const value = String(text || "").trim();
  if (!value) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function PanelTitle({ icon: Icon, title, detail }: { icon: React.ElementType; title: string; detail?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted/80" />
        <span className="truncate text-sm font-semibold text-text">{title}</span>
      </div>
      {detail && <span className="shrink-0 text-xs font-medium text-text-muted">{detail}</span>}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2.5 py-1.5">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-text">{value}</div>
    </div>
  );
}

function AutomationLogDetailDialog({
  log,
  copiedLogId,
  onOpenChange,
  onCopy,
}: {
  log: AutomationLogEntry | null;
  copiedLogId: number | null;
  onOpenChange: (open: boolean) => void;
  onCopy: (id: number, message: string) => void;
}) {
  if (!log) return null;

  const source = (log.source || "all") as MonitorSource;
  const level = logLevelMeta(log.type);
  const event = presentAutomationLog(log.message, source);
  const EventIcon = event.icon;

  return (
    <Dialog open={Boolean(log)} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[620px] overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 pr-14">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] select-none", level.badgeClass)}>
              <EventIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 select-text">
              <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className={cn("rounded-full border px-1.5 py-0.5 text-[0.58rem] font-bold select-none", level.badgeClass)}>{level.label}</span>
                <span className={cn("rounded-full border px-1.5 py-0.5 text-[0.58rem] font-semibold select-none", SOURCE_BADGE_CLASS[source])}>{SOURCE_LABELS[source]}</span>
                <span className="font-mono text-[0.62rem] text-text-muted">{formatDateTime(log.timestamp)}</span>
              </div>
              <DialogTitle className="truncate text-[0.9rem] font-bold text-text">{event.title}</DialogTitle>
              <DialogDescription className="mt-1 text-[0.72rem] leading-relaxed text-text-muted">
                {event.subtitle || "后台监控记录"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[min(68vh,560px)] space-y-3 overflow-y-auto px-4 py-3 select-text">
          {event.steps.length > 0 && (
            <div>
              <div className="mb-1.5 text-[0.66rem] font-bold text-text-muted select-none">处理进度</div>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {event.steps.map((step, index) => (
                  <div key={`${log.id}-dialog-step-${step}`} className={cn("rounded-[8px] border px-2 py-1.5", index === event.steps.length - 1 ? level.itemClass : "border-border bg-surface/35")}>
                    <div className="mb-1 flex items-center gap-1.5 text-[0.58rem] font-bold text-text-muted select-none">
                      <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border text-[0.55rem]", index === event.steps.length - 1 ? level.badgeClass : "border-border bg-surface text-text-muted")}>{index + 1}</span>
                      步骤
                    </div>
                    <div className="text-[0.7rem] font-semibold text-text">{step}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {event.details.length > 0 && (
            <div>
              <div className="mb-1.5 text-[0.66rem] font-bold text-text-muted select-none">详细信息</div>
              <div className="space-y-1.5">
                {event.details.map((detail, index) => (
                  <div key={`${log.id}-dialog-detail-${index}`} className="rounded-[8px] border border-border bg-surface/35 px-2.5 py-2 text-[0.7rem] leading-relaxed text-text-secondary">
                    {detail}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[0.66rem] font-bold text-text-muted select-none">原始日志</div>
            <div className="max-h-28 overflow-y-auto rounded-[8px] border border-border bg-surface/45 px-2.5 py-2 font-mono text-[0.65rem] leading-relaxed text-text-secondary">
              {log.message}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 select-none">
          <span className="truncate text-[0.64rem] text-text-muted select-text">点击列表项可查看完整日志详情</span>
          <Button variant="ghost" size="sm" onClick={() => onCopy(log.id, log.message)} className="h-7 shrink-0 px-2 text-[0.66rem]">
            {copiedLogId === log.id ? <Check className="mr-1 h-3.5 w-3.5 text-success" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
            {copiedLogId === log.id ? "已复制" : "复制日志"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function creatorEventLog(payload: CreatorMonitorEvent): { message: string; type: AutomationLogEntry["type"] } | null {
  const nickname = String(payload.nickname || payload.sec_uid || "监控用户").trim();
  switch (payload.event) {
    case "target_baseline":
      return {
        message: `作品监控已建立基线：${nickname} · 已记录 ${payload.seen ?? 0} 个作品`,
        type: "info",
      };
    case "target_checked": {
      const started = Number(payload.started || 0);
      const skipped = Number(payload.skipped_downloaded || 0);
      const errors = Number(payload.errors || 0);
      if (started > 0) {
        return {
          message: `作品监控发现新作品：${nickname} · 已加入下载 ${started} 个`,
          type: "success",
        };
      }
      if (errors > 0) {
        return {
          message: `作品监控检测异常：${nickname} · ${errors} 个作品加入下载失败`,
          type: "warning",
        };
      }
      return {
        message: `作品监控检测完成：${nickname} · 未发现新作品${skipped > 0 ? `，已跳过 ${skipped} 个已下载作品` : ""}`,
        type: "info",
      };
    }
    case "target_failed":
      return {
        message: `作品监控检测失败：${nickname} · ${payload.message || "接口请求失败"}`,
        type: "error",
      };
    default:
      return null;
  }
}

function buildCreatorTarget(secUid: string, nickname: string): CreatorMonitorTarget {
  const normalizedSecUid = secUid.trim();
  const normalizedNickname = nickname.trim() || normalizedSecUid;
  return {
    id: normalizedSecUid,
    sec_uid: normalizedSecUid,
    nickname: normalizedNickname,
    avatar_thumb: "",
    enabled: true,
    baseline_initialized: false,
    seen_aweme_ids: [],
    last_checked_at: 0,
    last_new_at: 0,
    downloaded_count: 0,
    last_error: "",
  };
}

function getRunStartedCount(result: unknown) {
  if (!result || typeof result !== "object") return 0;
  return Number((result as Record<string, unknown>).started || 0) || 0;
}

export function AutomationView() {
  const logs = useLogStore((s) => s.logs);
  const clearLogs = useLogStore((s) => s.clearLogs);
  const addLog = useLogStore((s) => s.addLog);
  const feedAutomationRunning = useAppStore((s) => s.feedAutomationRunning);
  const setFeedAutomationRunning = useAppStore((s) => s.setFeedAutomationRunning);
  const [config, setConfig] = useState<AiInteractionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<MonitorSource>("all");
  const [copiedLogId, setCopiedLogId] = useState<number | null>(null);
  const [selectedLog, setSelectedLog] = useState<AutomationLogEntry | null>(null);
  const [creatorMonitor, setCreatorMonitor] = useState<CreatorMonitorConfig | null>(null);
  const [creatorStatus, setCreatorStatus] = useState<CreatorMonitorStatus>(DEFAULT_CREATOR_MONITOR_STATUS);
  const [creatorSaving, setCreatorSaving] = useState(false);
  const [creatorChecking, setCreatorChecking] = useState(false);
  const [creatorDraft, setCreatorDraft] = useState({ secUid: "", nickname: "" });

  const loadConfig = async () => {
    setLoading(true);
    try {
      const [next, monitor] = await Promise.all([getConfig(), getCreatorMonitor()]);
      setConfig(normalizeAiAutomationConfig(next.ai_interaction) || DEFAULT_AI_CONFIG);
      setCreatorMonitor(normalizeCreatorMonitorConfig(monitor.config || next.creator_monitor));
      setCreatorStatus(monitor.status || DEFAULT_CREATOR_MONITOR_STATUS);
    } catch (error) {
      addLog(error instanceof Error ? error.message : "读取自动监控配置失败", "warning");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listenEvent<CreatorMonitorEvent>("creator-monitor-event", (payload) => {
      if (payload.status) setCreatorStatus(payload.status);
      const log = creatorEventLog(payload);
      if (log) addLog(log.message, log.type);
    }).then((unlisten) => {
      cleanup = unlisten;
    }).catch(() => {});
    return () => {
      cleanup?.();
    };
  }, [addLog]);

  const automationLogs = useMemo(() => {
    return logs
      .map((log) => ({ ...log, source: classifyLog(log.message) || "all" }))
      .filter((log) => isAutomationLog(log.message))
      .filter((log) => sourceFilter === "all" || log.source === sourceFilter);
  }, [logs, sourceFilter]);
  const visibleAutomationLogs = useMemo(() => [...automationLogs].reverse(), [automationLogs]);
  const logSummary = useMemo(() => ({
    total: automationLogs.length,
    success: automationLogs.filter((log) => log.type === "success").length,
    warning: automationLogs.filter((log) => log.type === "warning").length,
    error: automationLogs.filter((log) => log.type === "error").length,
    latest: automationLogs[automationLogs.length - 1]?.timestamp,
  }), [automationLogs]);
  const creatorConfig = creatorMonitor || DEFAULT_CREATOR_MONITOR_CONFIG;
  const enabledCreatorTargets = creatorConfig.targets.filter((target) => target.enabled).length;
  const creatorMonitorReady = Boolean(creatorConfig.enabled && enabledCreatorTargets > 0);

  const monitorCount = [
    config?.auto_monitor_feed,
    config?.auto_monitor_friends,
    config?.auto_monitor_notices,
    config?.auto_monitor_comments,
    creatorMonitorReady,
  ].filter(Boolean).length;

  const actionCount = [
    config?.auto_send_comments,
    config?.auto_send_private_messages,
    config?.auto_follow_back_on_new_follower,
    config?.auto_like,
    config?.auto_collect,
  ].filter(Boolean).length;

  const lastLogTime = automationLogs[automationLogs.length - 1]?.timestamp;
  const filterRows = [
    {
      label: "私信",
      match: splitKeywords(config?.auto_private_match_keywords || config?.auto_match_keywords),
      exclude: splitKeywords(config?.auto_private_exclude_keywords || config?.auto_exclude_keywords),
    },
    {
      label: "评论",
      match: splitKeywords(config?.auto_comment_match_keywords || config?.auto_match_keywords),
      exclude: splitKeywords(config?.auto_comment_exclude_keywords || config?.auto_exclude_keywords),
    },
    {
      label: "点赞",
      match: splitKeywords(config?.auto_like_match_keywords || config?.auto_match_keywords),
      exclude: splitKeywords(config?.auto_like_exclude_keywords || config?.auto_exclude_keywords),
    },
    {
      label: "收藏",
      match: splitKeywords(config?.auto_collect_match_keywords || config?.auto_match_keywords),
      exclude: splitKeywords(config?.auto_collect_exclude_keywords || config?.auto_exclude_keywords),
    },
  ];
  const feedActionReady = Boolean(config?.enabled && config.auto_monitor_feed && (config.auto_like || config.auto_collect));

  const saveAutomation = async (patch: Partial<AiInteractionConfig>) => {
    if (!config) return;
    setSaving(true);
    try {
      const nextAi = { ...config, ...patch };
      const result = await saveConfig({ ai_interaction: nextAi });
      if (!result.success) throw new Error(result.message || "自动监控配置保存失败");
      setConfig(normalizeAiAutomationConfig(nextAi) || DEFAULT_AI_CONFIG);
      setSettingsOpen(false);
      addLog("自动监控配置已保存", "success");
    } catch (error) {
      addLog(error instanceof Error ? error.message : "自动监控配置保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const updateCreatorMonitorDraft = (patch: Partial<CreatorMonitorConfig>) => {
    setCreatorMonitor((current) => ({
      ...(current || DEFAULT_CREATOR_MONITOR_CONFIG),
      ...patch,
    }));
  };

  const persistCreatorMonitor = async (nextConfig: CreatorMonitorConfig, successMessage: string) => {
    setCreatorSaving(true);
    try {
      const snapshot = await saveCreatorMonitor(nextConfig);
      setCreatorMonitor(snapshot.config);
      setCreatorStatus(snapshot.status || DEFAULT_CREATOR_MONITOR_STATUS);
      setSourceFilter("creators");
      addLog(successMessage, "success");
      return snapshot;
    } catch (error) {
      addLog(error instanceof Error ? error.message : "作品监控配置保存失败", "error");
      return null;
    } finally {
      setCreatorSaving(false);
    }
  };

  const saveCreatorMonitorDraft = async () => {
    await persistCreatorMonitor(creatorConfig, "作品监控配置已保存");
  };

  const toggleCreatorMonitor = async () => {
    if (!creatorConfig.enabled && creatorConfig.targets.length === 0) {
      addLog("作品监控无法开启：请先添加至少一个用户 sec_uid", "warning");
      return;
    }
    const nextEnabled = !creatorConfig.enabled;
    await persistCreatorMonitor(
      { ...creatorConfig, enabled: nextEnabled },
      nextEnabled ? "作品监控已开启" : "作品监控已暂停"
    );
  };

  const addCreatorTarget = async () => {
    const secUid = creatorDraft.secUid.trim();
    if (!secUid) {
      addLog("作品监控添加用户失败：sec_uid 不能为空", "warning");
      return;
    }
    const nextTarget = buildCreatorTarget(secUid, creatorDraft.nickname);
    const nextTargets = [
      ...creatorConfig.targets.filter((target) => target.sec_uid !== nextTarget.sec_uid),
      nextTarget,
    ];
    const snapshot = await persistCreatorMonitor(
      { ...creatorConfig, targets: nextTargets },
      `作品监控用户已添加：${nextTarget.nickname}`
    );
    if (snapshot) setCreatorDraft({ secUid: "", nickname: "" });
  };

  const toggleCreatorTarget = async (target: CreatorMonitorTarget) => {
    const nextTargets = creatorConfig.targets.map((item) =>
      item.sec_uid === target.sec_uid ? { ...item, enabled: !item.enabled } : item
    );
    await persistCreatorMonitor(
      { ...creatorConfig, targets: nextTargets },
      `${target.enabled ? "已暂停" : "已启用"}作品监控用户：${target.nickname || target.sec_uid}`
    );
  };

  const removeCreatorTarget = async (target: CreatorMonitorTarget) => {
    const nextTargets = creatorConfig.targets.filter((item) => item.sec_uid !== target.sec_uid);
    await persistCreatorMonitor(
      { ...creatorConfig, targets: nextTargets },
      `作品监控用户已移除：${target.nickname || target.sec_uid}`
    );
  };

  const runCreatorMonitorManual = async () => {
    if (!creatorMonitorReady) {
      addLog("作品监控无法立即检测：请开启监控并启用至少一个用户", "warning");
      return;
    }
    setCreatorChecking(true);
    try {
      const result = await runCreatorMonitorNow();
      const started = getRunStartedCount(result);
      const snapshot = await getCreatorMonitor();
      setCreatorMonitor(snapshot.config);
      setCreatorStatus(snapshot.status || DEFAULT_CREATOR_MONITOR_STATUS);
      setSourceFilter("creators");
      addLog(
        started > 0 ? `作品监控手动检测完成：已加入下载 ${started} 个新作品` : "作品监控手动检测完成：未发现需要下载的新作品",
        started > 0 ? "success" : "info"
      );
    } catch (error) {
      addLog(error instanceof Error ? error.message : "作品监控立即检测失败", "error");
    } finally {
      setCreatorChecking(false);
    }
  };

  const channels = [
    {
      title: "推荐流",
      description: "视频扫描、点赞、收藏",
      active: Boolean(config?.enabled && config.auto_monitor_feed),
      icon: RefreshCw,
    },
    {
      title: "好友私信",
      description: "新消息监听、自动回复",
      active: Boolean(config?.enabled && config.auto_monitor_friends),
      icon: Users,
    },
    {
      title: "通知互动",
      description: "评论回复、关注回关",
      active: Boolean(config?.enabled && config.auto_monitor_notices),
      icon: Bell,
    },
    {
      title: "评论区",
      description: "评论分析、跟评辅助",
      active: Boolean(config?.enabled && config.auto_monitor_comments),
      icon: MessageSquare,
    },
    {
      title: "作品监控",
      description: "创作者更新、自动下载",
      active: creatorMonitorReady,
      icon: Download,
    },
  ];

  const actions = [
    { label: "评论", active: Boolean(config?.auto_send_comments), icon: Send },
    { label: "私信", active: Boolean(config?.auto_send_private_messages), icon: Send },
    { label: "回关", active: Boolean(config?.auto_follow_back_on_new_follower), icon: UserPlus },
    { label: "点赞", active: Boolean(config?.auto_like), icon: ThumbsUp },
    { label: "收藏", active: Boolean(config?.auto_collect), icon: Star },
    { label: "上下文保护", active: Boolean(config?.auto_require_context), icon: ShieldCheck },
  ];

  const toggleFeedAutomation = () => {
    if (feedAutomationRunning) {
      setFeedAutomationRunning(false);
      return;
    }
    if (!config?.enabled) {
      addLog("推荐流自动刷视频无法开始：自动监控总开关未开启", "warning");
      return;
    }
    if (!config.auto_monitor_feed) {
      addLog("推荐流自动刷视频无法开始：推荐流监控未开启", "warning");
      return;
    }
    if (!config.auto_like && !config.auto_collect) {
      addLog("推荐流自动刷视频无法开始：点赞/收藏动作未开启", "warning");
      return;
    }
    setSourceFilter("feed");
    setFeedAutomationRunning(true);
  };

  const copyLog = async (id: number, message: string) => {
    try {
      await copyTextToClipboard(message);
      setCopiedLogId(id);
      window.setTimeout(() => setCopiedLogId((current) => (current === id ? null : current)), 1400);
    } catch {
      // Clipboard permission can fail in some embedded runtimes; keep the UI quiet.
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <div className="mb-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", (config?.enabled || creatorStatus.running) ? "bg-success" : "bg-text-muted/45")} />
            <h3 className="truncate text-base font-semibold text-text">自动后台监测与过滤</h3>
          </div>
          <div className="mt-1 text-xs text-text-muted">统一管理后台监听、过滤规则与自动执行记录</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadConfig()}
            disabled={loading}
            className="shrink-0"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            同步
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            disabled={!config}
            className="shrink-0"
          >
            <Settings2 className="h-3.5 w-3.5" />
            设置
          </Button>
        </div>
      </div>

      <div className="mb-2 grid rounded-[var(--radius-md)] bg-surface/35 sm:grid-cols-4">
            <SummaryItem label="状态" value={(config?.enabled || creatorStatus.running) ? "运行中" : "已暂停"} />
            <SummaryItem label="通道" value={`${monitorCount}/5`} />
            <SummaryItem label="动作" value={`${actionCount}/5`} />
            <SummaryItem label="最近" value={formatTime(lastLogTime)} />
      </div>

      <SectionSurface density="compact" tone="muted" className="mb-2 rounded-[var(--radius-md)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <PanelTitle icon={RefreshCw} title="推荐流自动刷视频" detail={feedAutomationRunning ? "运行中" : "已停止"} />
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
              <span>动作：{config?.auto_like ? "点赞" : "不点赞"} / {config?.auto_collect ? "收藏" : "不收藏"}</span>
              <span>间隔：{config?.auto_scan_interval_seconds ?? 30}s</span>
              <span>单轮：{config?.auto_max_actions_per_run ?? 5} 条</span>
              <span className={cn(feedActionReady ? "text-success" : "text-warning")}>
                {feedActionReady ? "配置就绪" : "需要开启总开关、推荐流和点赞/收藏"}
              </span>
            </div>
          </div>
          <Button
            variant={feedAutomationRunning ? "outline" : "default"}
            size="sm"
            onClick={toggleFeedAutomation}
            disabled={!config}
            className="shrink-0"
          >
            {feedAutomationRunning ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {feedAutomationRunning ? "停止" : "开始"}
          </Button>
        </div>
      </SectionSurface>

      <SectionSurface density="compact" tone="muted" className="mb-2 rounded-[var(--radius-md)]">
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <PanelTitle icon={Download} title="创作者作品监控" detail={creatorStatus.running ? "运行中" : creatorConfig.enabled ? "等待启动" : "已暂停"} />
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
              <span>间隔：{formatCreatorInterval(creatorConfig.interval_minutes)}</span>
              <span>用户：{enabledCreatorTargets}/{creatorConfig.targets.length}</span>
              <span>下次：{formatUnixDateTime(creatorStatus.next_run_at)}</span>
              <span className={cn(creatorMonitorReady ? "text-success" : "text-warning")}>
                {creatorMonitorReady ? "新作品自动加入下载队列" : "需要开启监控并启用用户"}
              </span>
            </div>
            <div className="mt-1 truncate text-xs text-text-muted">{creatorStatus.message || "首次后台检测建立基线，之后发现新作品自动下载。"}</div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant={creatorConfig.enabled ? "outline" : "default"}
              size="sm"
              onClick={() => void toggleCreatorMonitor()}
              disabled={creatorSaving || !creatorMonitor}
            >
              {creatorConfig.enabled ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {creatorConfig.enabled ? "暂停" : "开启"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void saveCreatorMonitorDraft()}
              disabled={creatorSaving || !creatorMonitor}
            >
              <Check className="h-3.5 w-3.5" />
              保存
            </Button>
            <Button
              variant="info-outline"
              size="sm"
              onClick={() => void runCreatorMonitorManual()}
              disabled={creatorChecking || creatorSaving || !creatorMonitorReady}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", creatorChecking && "animate-spin")} />
              立即检测
            </Button>
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="grid gap-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="grid gap-1.5 text-xs text-text-muted">
                检测间隔（分钟）
                <Input
                  type="number"
                  min={CREATOR_MONITOR_MIN_INTERVAL_MINUTES}
                  max={CREATOR_MONITOR_MAX_INTERVAL_MINUTES}
                  value={numberInputValue(creatorConfig.interval_minutes)}
                  onChange={(event) => updateCreatorMonitorDraft({ interval_minutes: Number(event.target.value) || CREATOR_MONITOR_MIN_INTERVAL_MINUTES })}
                  className="h-8 text-xs"
                />
              </label>
              <label className="grid gap-1.5 text-xs text-text-muted">
                每次拉取
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={numberInputValue(creatorConfig.fetch_count)}
                  onChange={(event) => updateCreatorMonitorDraft({ fetch_count: Number(event.target.value) || 20 })}
                  className="h-8 text-xs"
                />
              </label>
              <label className="grid gap-1.5 text-xs text-text-muted">
                下载上限
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={numberInputValue(creatorConfig.max_new_downloads_per_check)}
                  onChange={(event) => updateCreatorMonitorDraft({ max_new_downloads_per_check: Number(event.target.value) || 10 })}
                  className="h-8 text-xs"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
              <div className="rounded-[8px] bg-surface/45 px-2 py-1.5">
                <div className="text-text-muted">最小间隔</div>
                <div className="mt-0.5 font-semibold text-text">10 分钟</div>
              </div>
              <div className="rounded-[8px] bg-surface/45 px-2 py-1.5">
                <div className="text-text-muted">最大间隔</div>
                <div className="mt-0.5 font-semibold text-text">每天一次</div>
              </div>
              <div className="rounded-[8px] bg-surface/45 px-2 py-1.5">
                <div className="text-text-muted">上次检测</div>
                <div className="mt-0.5 truncate font-semibold text-text">{formatUnixDateTime(creatorStatus.last_run_at)}</div>
              </div>
              <div className="rounded-[8px] bg-surface/45 px-2 py-1.5">
                <div className="text-text-muted">累计下载</div>
                <div className="mt-0.5 font-semibold text-text">{creatorConfig.targets.reduce((sum, target) => sum + (Number(target.downloaded_count) || 0), 0)} 个</div>
              </div>
            </div>
            <div className="grid gap-2 rounded-[9px] bg-surface/35 p-2 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)_auto]">
              <Input
                value={creatorDraft.secUid}
                onChange={(event) => setCreatorDraft((current) => ({ ...current, secUid: event.target.value }))}
                placeholder="sec_uid"
                className="h-8 font-mono text-xs"
              />
              <Input
                value={creatorDraft.nickname}
                onChange={(event) => setCreatorDraft((current) => ({ ...current, nickname: event.target.value }))}
                placeholder="昵称，可选"
                className="h-8 text-xs"
              />
              <Button
                variant="default"
                size="sm"
                onClick={() => void addCreatorTarget()}
                disabled={creatorSaving}
                className="h-8 px-3 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                添加
              </Button>
            </div>
          </div>

          <div className="min-h-[128px] rounded-[9px] bg-surface/25 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-text">监控用户</div>
              <Badge variant={creatorMonitorReady ? "success" : "secondary"} size="sm">
                {creatorStatus.running ? "后台运行" : creatorConfig.enabled ? "已开启" : "未开启"}
              </Badge>
            </div>
            <div className="max-h-[238px] space-y-1.5 overflow-y-auto pr-1">
              {creatorConfig.targets.length > 0 ? (
                creatorConfig.targets.map((target) => (
                  <div key={target.sec_uid} className="flex min-w-0 items-center gap-2 rounded-[8px] border border-border bg-surface/40 px-2 py-1.5">
                    {target.avatar_thumb ? (
                      <img src={target.avatar_thumb} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-text-muted">
                        <Users className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-text">{target.nickname || target.sec_uid}</span>
                        <Badge variant={target.enabled ? "success" : "outline"} size="sm">{target.enabled ? "启用" : "暂停"}</Badge>
                        {!target.baseline_initialized && <Badge variant="warning" size="sm">待基线</Badge>}
                      </div>
                      <div className="mt-0.5 min-w-0 truncate font-mono text-[0.62rem] text-text-muted">{target.sec_uid}</div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[0.62rem] text-text-muted">
                        <span>上次 {formatUnixDateTime(target.last_checked_at)}</span>
                        <span>新作品 {formatUnixDateTime(target.last_new_at)}</span>
                        <span>下载 {target.downloaded_count || 0}</span>
                        {target.last_error && <span className="text-danger">错误：{target.last_error}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => void toggleCreatorTarget(target)} disabled={creatorSaving} className="h-7 px-2 text-[0.66rem]">
                        {target.enabled ? "暂停" : "启用"}
                      </Button>
                      <Button variant="danger-outline" size="sm" onClick={() => void removeCreatorTarget(target)} disabled={creatorSaving} className="h-7 px-2 text-[0.66rem]">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex h-[132px] flex-col items-center justify-center text-center">
                  <Users className="mb-2 h-5 w-5 text-text-muted/70" />
                  <div className="text-sm font-semibold text-text">还没有监控用户</div>
                  <div className="mt-1 text-xs text-text-muted">添加 sec_uid 后，后台会按间隔检测新作品。</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </SectionSurface>

      <div className="mb-2 grid gap-2 lg:grid-cols-[1.08fr_0.92fr]">
        <SectionSurface density="compact" tone="muted" className="rounded-[var(--radius-md)]">
          <PanelTitle icon={Activity} title="运行通道" detail="后台任务" />
          <div className="grid gap-2 sm:grid-cols-2">
            {channels.map(({ title, description, active, icon: Icon }) => (
              <div
                key={title}
                className={cn(
                  "flex min-w-0 items-center gap-2.5 rounded-[9px] px-2.5 py-2 transition-colors",
                  active ? "bg-success-soft/25" : "bg-surface/35"
                )}
              >
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]", active ? "bg-surface-raised text-success" : "bg-surface-raised text-text-muted")}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text">{title}</div>
                  <div className="mt-0.5 truncate text-xs text-text-muted">{description}</div>
                </div>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-success" : "bg-text-muted/35")} />
              </div>
            ))}
          </div>
        </SectionSurface>

        <SectionSurface density="compact" tone="muted" className="rounded-[var(--radius-md)]">
          <PanelTitle icon={Filter} title="规则摘要" detail="过滤与限流" />
          <div className="grid gap-2 text-xs">
            <div className="grid grid-cols-3 gap-1.5">
              {[
                ["扫描", `${config?.auto_scan_interval_seconds ?? 30}s`],
                ["上限", `${config?.auto_max_actions_per_run ?? 5} 条`],
                ["延迟", `${config?.auto_send_delay_ms ?? 0}ms`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[8px] bg-surface/45 px-2 py-1.5">
                  <div className="text-xs text-text-muted">{label}</div>
                  <div className="mt-0.5 truncate font-semibold text-text">{value}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-1.5">
              {filterRows.map(({ label, match, exclude }) => (
                <div key={label} className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-2">
                  <span className="shrink-0 text-text-muted">{label}</span>
                  <span className="min-w-0 truncate text-text">
                    匹配 {match.length ? match.join("、") : "不限"} · 排除 {exclude.length ? exclude.join("、") : "无"}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {actions.filter((item) => item.active).length ? (
                actions.filter((item) => item.active).map(({ label, icon: Icon }) => (
                  <span key={label} className="inline-flex items-center gap-1 rounded-[7px] bg-surface/50 px-1.5 py-0.5 text-xs font-medium text-text">
                    <Icon className="h-3 w-3 text-text-muted" />
                    {label}
                  </span>
                ))
              ) : (
                <span className="rounded-[7px] bg-surface/50 px-1.5 py-0.5 text-xs text-text-muted">未开启执行动作</span>
              )}
            </div>
          </div>
        </SectionSurface>
      </div>

      <SectionSurface density="compact" tone="muted" className="rounded-[var(--radius-md)]">
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <PanelTitle icon={Search} title="监测日志" detail={`${automationLogs.length} 条`} />
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={sourceFilter} onValueChange={(value) => setSourceFilter(value as MonitorSource)}>
              <TabsList className="h-8">
                {(Object.keys(SOURCE_LABELS) as MonitorSource[]).map((source) => (
                  <TabsTrigger key={source} value={source} className="data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-[0_6px_18px_rgba(254,44,85,0.24)]">
                    {SOURCE_LABELS[source]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSelectedLog(null); clearLogs(); }}
              className="shrink-0"
            >
              清空
            </Button>
          </div>
        </div>

        <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {[
            ["筛选", SOURCE_LABELS[sourceFilter], "text-text"],
            ["总数", `${logSummary.total} 条`, "text-text"],
            ["成功", `${logSummary.success} 条`, "text-success"],
            ["提醒/错误", `${logSummary.warning + logSummary.error} 条`, logSummary.error > 0 ? "text-danger" : logSummary.warning > 0 ? "text-warning" : "text-text-muted"],
            ["最近", formatTime(logSummary.latest), "text-text"],
          ].map(([label, value, valueClass]) => (
            <div key={label} className="min-w-0 rounded-[8px] border border-border bg-surface/35 px-2 py-1.5">
              <div className="text-[0.6rem] font-semibold text-text-muted">{label}</div>
              <div className={cn("mt-0.5 truncate text-xs font-bold", valueClass)}>{value}</div>
            </div>
          ))}
        </div>

        <ScrollArea className="h-[calc(100vh-350px)] min-h-[430px] max-h-[680px] rounded-[var(--radius-md)] bg-surface/25 px-2.5 py-2 text-xs">
          <div className="space-y-1.5">
            {automationLogs.length > 0 ? (
              visibleAutomationLogs.map((log) => {
                const source = (log.source || "all") as MonitorSource;
                const level = logLevelMeta(log.type);
                const event = presentAutomationLog(log.message, source);
                const EventIcon = event.icon;
                return (
                  <div
                    key={log.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedLog(log)}
                    onKeyDown={(keyboardEvent) => {
                      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                        keyboardEvent.preventDefault();
                        setSelectedLog(log);
                      }
                    }}
                    className={cn(
                      "group flex min-w-0 cursor-pointer items-center gap-2 rounded-[8px] border px-2 py-1.5 outline-none transition-colors hover:bg-surface-raised/55 focus-visible:ring-2 focus-visible:ring-accent/35",
                      level.itemClass
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", level.dotClass)} />
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]", level.badgeClass)}>
                      <EventIcon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-[0.72rem] font-bold leading-snug text-text">{event.title}</span>
                        <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[0.55rem] font-bold", level.badgeClass)}>
                          {level.label}
                        </span>
                        <span className={cn("hidden shrink-0 rounded-full border px-1.5 py-px text-[0.55rem] font-semibold sm:inline-flex", SOURCE_BADGE_CLASS[source])}>
                          {SOURCE_LABELS[source]}
                        </span>
                      </div>
                      <div className="mt-0.5 min-w-0 truncate text-[0.62rem] leading-snug text-text-muted">
                        {event.subtitle || log.message}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="hidden font-mono text-[0.6rem] text-text-muted sm:inline">{formatDateTime(log.timestamp)}</span>
                      <button
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          void copyLog(log.id, log.message);
                        }}
                        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[0.58rem] font-semibold text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                        title="复制这条日志"
                      >
                        {copiedLogId === log.id ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                        <span className="hidden sm:inline">{copiedLogId === log.id ? "已复制" : "复制"}</span>
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center text-center">
                <Clock3 className="mb-2 h-5 w-5 text-text-muted/70" />
                <div className="text-sm font-semibold text-text">暂无监控日志</div>
                <div className="mt-1 text-xs text-text-muted">后台监控触发后会显示在这里。</div>
              </div>
            )}
          </div>
        </ScrollArea>
      </SectionSurface>

      <AutomationLogDetailDialog
        log={selectedLog}
        copiedLogId={copiedLogId}
        onOpenChange={(open) => {
          if (!open) setSelectedLog(null);
        }}
        onCopy={(id, message) => void copyLog(id, message)}
      />

      <AutomationSettingsDialog
        open={settingsOpen}
        config={config}
        saving={saving}
        onOpenChange={setSettingsOpen}
        onSave={saveAutomation}
      />
    </div>
  );
}
