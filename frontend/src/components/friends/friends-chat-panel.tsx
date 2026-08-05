import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import { Archive, Loader2, RotateCcw, UserRound } from "lucide-react";
import { SectionSurface } from "@/components/common/surface";
import { Badge } from "@/components/ui/badge";
import { ThemeLogo } from "@/components/common/theme-logo";
import { mediaProxyUrl, suggestAiInteraction } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
  MAX_SEND_IMAGE_BYTES,
  type FriendStatusItem,
  type ChatSession,
  type LocalChatMessage,
  type PendingImageAttachment,
  type SharedMessageCard,
} from "./friends-status-types";
import {
  friendDisplayName,
  isSameMessageDate,
} from "./friends-status-utils";
import { buildPrivateMessageAiContext } from "./friends-chat-session";
import { FriendsMessageList } from "./friends-message-list";
import { FriendsChatInput } from "./friends-chat-input";
import { ChatEmptyState } from "./friends-empty-state";

const AI_CONTEXT_CHAR_LIMIT = 900;

function trimAiText(value: string, limit = AI_CONTEXT_CHAR_LIMIT) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(-limit) : text;
}

function pickLatestIncomingMessage(messages: LocalChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "in") return message;
  }
  return null;
}

function normalizeAiSuggestions(draft: string, suggestions?: string[]) {
  const items = suggestions && suggestions.length > 0 ? suggestions : [draft];
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, 3);
}

function getAiAutoSendDelayMs(value?: number) {
  const delay = Number(value ?? 0);
  if (!Number.isFinite(delay)) return 0;
  return Math.max(0, Math.min(10000, Math.trunc(delay)));
}

function formatAiAutoBlockHint(reasons?: string[]) {
  const items = (reasons || []).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? `自动发送已阻止：${items.join("，")}` : "";
}

function waitForAiAutoSend(delayMs: number) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

interface FriendsChatPanelProps {
  friend: FriendStatusItem | null;
  draft: string;
  messages: LocalChatMessage[];
  session?: ChatSession;
  historyError: string;
  historyLoading: boolean;
  canLoadOlder: boolean;
  currentUserAvatar: string;
  onDraftChange: (secUid: string, value: string) => void;
  onSendMessage: (friend: FriendStatusItem, value: string) => Promise<void>;
  onSendImage: (friend: FriendStatusItem, file: File) => Promise<void>;
  onSendVideo: (friend: FriendStatusItem, file: File) => Promise<void>;
  onStartNewSession: (friend: FriendStatusItem) => void;
  onCompressSession: (friend: FriendStatusItem) => void;
  onLoadOlder: () => Promise<void>;
  onOpenProfile: (friend: FriendStatusItem) => Promise<void>;
  onOpenSharedVideo: (card: SharedMessageCard) => Promise<void>;
  onOpenLocalVideo: (message: LocalChatMessage) => void;
  sharedPlayerLoadingId: string;
}

export function FriendsChatPanel({
  friend,
  draft,
  messages,
  session,
  historyError,
  historyLoading,
  canLoadOlder,
  currentUserAvatar,
  onDraftChange,
  onSendMessage,
  onSendImage,
  onSendVideo,
  onStartNewSession,
  onCompressSession,
  onLoadOlder,
  onOpenProfile,
  onOpenSharedVideo,
  onOpenLocalVideo,
  sharedPlayerLoadingId,
}: FriendsChatPanelProps) {
  const displayName = friendDisplayName(friend);
  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>([]);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiHint, setAiHint] = useState("");
  const pendingImagesRef = useRef<PendingImageAttachment[]>([]);
  const hasDraft = Boolean(draft.trim());
  const hasPendingImages = pendingImages.length > 0;
  const canSend = Boolean(friend && (hasDraft || hasPendingImages));
  const textSending = messages.some((message) => message.status === "pending" && !message.imagePreviewUrl);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const preserveScrollOffsetRef = useRef<number | null>(null);
  const preserveScrollUntilRef = useRef(0);
  const olderLoadArmedRef = useRef(false);
  const ignoreScrollUntilRef = useRef(0);
  const pinBottomUntilRef = useRef(0);
  const userScrollIntentUntilRef = useRef(0);
  const lastScrollTopRef = useRef(0);

  const latestMessageId = messages.length > 0 ? messages[messages.length - 1].id : "";
  const oldestMessageId = messages.length > 0 ? messages[0].id : "";

  const markProgrammaticScroll = useCallback(() => {
    ignoreScrollUntilRef.current = Date.now() + 280;
  }, []);

  const scrollToBottom = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    pinBottomUntilRef.current = Date.now() + 2600;
    markProgrammaticScroll();
    scroller.scrollTop = scroller.scrollHeight;
    bottomAnchorRef.current?.scrollIntoView({ block: "end" });
  }, [markProgrammaticScroll]);

  const isNearBottom = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
  }, []);

  const restorePreservedScroll = useCallback(() => {
    const scroller = scrollRef.current;
    const offset = preserveScrollOffsetRef.current;
    if (!scroller || offset === null) return false;
    markProgrammaticScroll();
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - offset);
    return true;
  }, [markProgrammaticScroll]);

  const scheduleScrollToBottom = useCallback(() => {
    pinBottomUntilRef.current = Date.now() + 2600;
    let disposed = false;
    const timers: number[] = [];
    const frames: number[] = [];
    const run = () => {
      if (!disposed) scrollToBottom();
    };
    frames.push(window.requestAnimationFrame(run));
    frames.push(window.requestAnimationFrame(() => {
      frames.push(window.requestAnimationFrame(run));
    }));
    for (const delay of [60, 180, 420]) {
      timers.push(window.setTimeout(run, delay));
    }
    return () => {
      disposed = true;
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [scrollToBottom]);

  useEffect(() => {
    return scheduleScrollToBottom();
  }, [friend?.secUid, latestMessageId, scheduleScrollToBottom]);

  useEffect(() => {
    if (preserveScrollOffsetRef.current === null) return;
    preserveScrollUntilRef.current = Date.now() + 1600;
    const frames: number[] = [];
    const timers: number[] = [];
    const restore = () => {
      restorePreservedScroll();
    };
    frames.push(window.requestAnimationFrame(restore));
    frames.push(window.requestAnimationFrame(() => {
      frames.push(window.requestAnimationFrame(restore));
    }));

    for (const delay of [80, 240, 520]) {
      timers.push(window.setTimeout(restore, delay));
    }
    timers.push(window.setTimeout(() => {
      preserveScrollOffsetRef.current = null;
    }, 1700));
    return () => {
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [oldestMessageId, restorePreservedScroll]);

  useEffect(() => {
    olderLoadArmedRef.current = false;
    preserveScrollOffsetRef.current = null;
    preserveScrollUntilRef.current = 0;
    pinBottomUntilRef.current = Date.now() + 2600;
    userScrollIntentUntilRef.current = 0;
  }, [friend?.secUid]);

  const handleMediaSettled = useCallback(() => {
    if (preserveScrollOffsetRef.current !== null && Date.now() < preserveScrollUntilRef.current) {
      restorePreservedScroll();
      return;
    }
    if (Date.now() < pinBottomUntilRef.current || isNearBottom()) {
      scheduleScrollToBottom();
    }
  }, [isNearBottom, restorePreservedScroll, scheduleScrollToBottom]);

  useEffect(() => {
    setPendingImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, [friend?.secUid]);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => () => {
    pendingImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  const handleSendMessage = () => {
    if (!friend || !canSend) return;
    const imagesToSend = pendingImages;
    setPendingImages([]);
    if (hasDraft) {
      void onSendMessage(friend, draft);
    }
    for (const image of imagesToSend) {
      void onSendImage(friend, image.file);
      URL.revokeObjectURL(image.previewUrl);
    }
  };

  const handlePickImage = () => {
    if (!friend) return;
    imageInputRef.current?.click();
  };
  const handlePickVideo = () => { if (friend) videoInputRef.current?.click(); };
  const handleVideoInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (friend && file) void onSendVideo(friend, file);
  };

  const addPendingImageFiles = useCallback((files: File[]) => {
    if (!friend || files.length === 0) return;
    const nextImages = files
      .filter((file) => file.type.startsWith("image/") && file.size <= MAX_SEND_IMAGE_BYTES)
      .map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    if (nextImages.length === 0) return;
    setPendingImages((current) => {
      const merged = [...current, ...nextImages];
      const kept = merged.slice(0, 9);
      merged.slice(9).forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return kept;
    });
  }, [friend]);

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    addPendingImageFiles(files);
  };

  const handleDraftPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    addPendingImageFiles(imageFiles);
  };

  const removePendingImage = (id: string) => {
    setPendingImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };

  const markUserScrollIntent = useCallback(() => {
    userScrollIntentUntilRef.current = Date.now() + 900;
  }, []);

  const handleMessageScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const scrollTop = scroller.scrollTop;
    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;
    if (Date.now() < ignoreScrollUntilRef.current) return;
    if (scrollTop < previousScrollTop - 4) {
      pinBottomUntilRef.current = 0;
    }
    if (!friend || historyLoading || !canLoadOlder) return;
    if (Date.now() > userScrollIntentUntilRef.current) return;
    if (scroller.scrollHeight <= scroller.clientHeight + 4) return;
    if (scroller.scrollTop > 140) {
      olderLoadArmedRef.current = true;
      return;
    }
    if (scroller.scrollTop > 72) return;
    if (!olderLoadArmedRef.current) return;
    if (scrollTop >= previousScrollTop - 4) return;
    olderLoadArmedRef.current = false;
    preserveScrollOffsetRef.current = scroller.scrollHeight - scroller.scrollTop;
    preserveScrollUntilRef.current = Date.now() + 1600;
    void onLoadOlder();
  };

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    handleSendMessage();
  };

  const applyAiSuggestion = (suggestion: string) => {
    if (!friend) return;
    onDraftChange(friend.secUid, suggestion);
    setAiHint("已替换为选中的 AI 草稿");
  };

  const handleAiSuggest = async () => {
    if (!friend || aiSuggesting) return;
    const recentMessages = messages.slice(-8);
    const latestIncoming = pickLatestIncomingMessage(recentMessages);
    const context = buildPrivateMessageAiContext(session, messages, displayName);

    setAiSuggesting(true);
    setAiHint("正在生成 AI 回复候选...");
    try {
      const result = await suggestAiInteraction({
        target: "private_message",
        context,
        incoming_text: trimAiText(latestIncoming?.text || latestIncoming?.rawContent || "", 360),
        author_name: displayName,
        tone: "warm",
        language: "zh-CN",
        max_suggestions: 3,
      });
      const suggestions = normalizeAiSuggestions(result.draft || "", result.suggestions);
      setAiSuggestions(suggestions);
      const autoBlockHint = formatAiAutoBlockHint(result.auto_block_reasons);
      if (suggestions.length === 0) {
        setAiHint("暂时没有生成可用建议，请稍后再试");
      } else if (result.actions?.send_private_message) {
        try {
          const delayMs = getAiAutoSendDelayMs(result.auto_send_delay_ms);
          if (delayMs > 0) {
            setAiHint(`将在 ${(delayMs / 1000).toFixed(1)} 秒后自动发送 AI 回复`);
            await waitForAiAutoSend(delayMs);
          }
          await onSendMessage(friend, suggestions[0]);
          onDraftChange(friend.secUid, "");
          setAiHint("已自动发送 AI 回复");
        } catch (sendError) {
          onDraftChange(friend.secUid, suggestions[0]);
          setAiHint(sendError instanceof Error ? `自动发送失败，已保留 AI 草稿：${sendError.message}` : "自动发送失败，已保留 AI 草稿");
        }
      } else if (draft.trim()) {
        setAiHint(autoBlockHint || "已生成 AI 候选，点击下方短句可替换当前草稿");
      } else {
        onDraftChange(friend.secUid, suggestions[0]);
        setAiHint(autoBlockHint || "已填入 AI 草稿，可继续编辑后手动发送");
      }
    } catch (error) {
      setAiHint(error instanceof Error ? `AI 建议暂时不可用：${error.message}` : "AI 建议暂时不可用，请稍后再试。");
    } finally {
      setAiSuggesting(false);
    }
  };

  return (
    <SectionSurface density="none" className="flex min-h-[420px] min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label={friend ? `打开 ${displayName} 主页` : "好友主页"}
            title={friend ? `打开 ${displayName} 主页` : "好友主页"}
            disabled={!friend}
            onClick={() => friend && void onOpenProfile(friend)}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-raised outline-none ring-accent/35 transition hover:ring-2 focus-visible:ring-2 disabled:pointer-events-none disabled:hover:ring-0"
          >
            {friend?.avatar ? (
              <img src={mediaProxyUrl(friend.avatar, "image")} alt="" className="h-full w-full object-cover" />
            ) : (
              <UserRound className="h-4 w-4 text-text-muted" />
            )}
            {friend && (
              <span
                className={cn(
                  "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface",
                  friend.online ? "bg-success" : "bg-text-muted",
                )}
              />
            )}
          </button>
          <div className="min-w-0">
            <p className="truncate text-[0.86rem] font-semibold text-text">
              {friend ? displayName : "选择好友"}
            </p>
            <p className="truncate text-[0.7rem] text-text-muted">
              {friend ? `${friend.statusText} · ${friend.lastActive}` : "左侧列表会同步好友在线状态"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {friend && (
            <div className="hidden items-center gap-1 sm:flex">
              <button type="button" onClick={() => onCompressSession(friend)} title="将较早消息压缩为本地 AI 上下文摘要" className="flex h-7 items-center gap-1 rounded px-2 text-[0.68rem] text-text-muted hover:bg-surface-raised">
                <Archive className="h-3.5 w-3.5" />压缩上下文
              </button>
              <button type="button" onClick={() => onStartNewSession(friend)} title="开始新会话：保留聊天记录，但后续 AI 不再引用此前上下文" className="flex h-7 items-center gap-1 rounded px-2 text-[0.68rem] text-text-muted hover:bg-surface-raised">
                <RotateCcw className="h-3.5 w-3.5" />新会话
              </button>
            </div>
          )}
          <Badge variant={friend?.online ? "success" : "secondary"} size="sm">
            {friend?.online ? "在线" : "离线"}
          </Badge>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {historyError && (
          <div className="border-b border-white/[0.06] bg-danger-soft px-4 py-2 text-[0.72rem] text-danger">
            {historyError}
          </div>
        )}
        {friend && (session?.summary || session?.compressedMessageCount) && (
          <div className="border-b border-border bg-surface-raised/50 px-4 py-1.5 text-[0.68rem] text-text-muted">
            当前 AI 会话已压缩 {session.compressedMessageCount} 条早期消息；生成回复时会连同最近往来一起使用。
          </div>
        )}

        {friend ? (
          <FriendsMessageList
            friend={friend}
            messages={messages}
            historyLoading={historyLoading}
            currentUserAvatar={currentUserAvatar}
            onOpenSharedVideo={onOpenSharedVideo}
            onOpenLocalVideo={onOpenLocalVideo}
            sharedPlayerLoadingId={sharedPlayerLoadingId}
            onMediaSettled={handleMediaSettled}
            onOpenProfile={onOpenProfile}
            scrollRef={scrollRef}
            bottomAnchorRef={bottomAnchorRef}
            markUserScrollIntent={markUserScrollIntent}
            handleMessageScroll={handleMessageScroll}
            draft={draft}
          />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <ChatEmptyState />
          </div>
        )}

        <FriendsChatInput
          friend={friend}
          draft={draft}
          onDraftChange={onDraftChange}
          onSendMessage={handleSendMessage}
          onPickImage={handlePickImage}
          onPickVideo={handlePickVideo}
          onSuggestReply={() => void handleAiSuggest()}
          imageInputRef={imageInputRef}
          videoInputRef={videoInputRef}
          onImageInputChange={handleImageInputChange}
          onVideoInputChange={handleVideoInputChange}
          pendingImages={pendingImages}
          onRemovePendingImage={removePendingImage}
          onDraftKeyDown={handleDraftKeyDown}
          onDraftPaste={handleDraftPaste}
          canSend={canSend}
          textSending={textSending}
          aiSuggesting={aiSuggesting}
          aiSuggestions={aiSuggestions}
          aiHint={aiHint}
          onApplyAiSuggestion={applyAiSuggestion}
          onClearAiSuggestions={() => { setAiSuggestions([]); setAiHint(""); }}
          displayName={displayName}
        />
      </div>
    </SectionSurface>
  );
}
