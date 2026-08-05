import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Images, Loader2, MapPin, MessageCircle, Play, ShoppingBag, UserRound } from "lucide-react";
import { mediaProxyUrl } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type {
  FriendStatusItem,
  LocalChatMessage,
  SharedMessageCard,
} from "./friends-status-types";
import {
  centerNoticeText,
  formatMessageDividerTime,
  formatMessageTime,
  hasFramedMessageBody,
  isSameMessageDate,
  parseSharedMessage,
  unsignedMediaUrl,
} from "./friends-status-utils";
import { MessageAvatar } from "./friends-avatar";

interface FriendsMessageListProps {
  friend: FriendStatusItem;
  messages: LocalChatMessage[];
  historyLoading: boolean;
  currentUserAvatar: string;
  onOpenSharedVideo: (card: SharedMessageCard) => Promise<void>;
  onOpenLocalVideo: (message: LocalChatMessage) => void;
  sharedPlayerLoadingId: string;
  onMediaSettled: () => void;
  onOpenProfile: (friend: FriendStatusItem) => Promise<void>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  bottomAnchorRef: React.RefObject<HTMLDivElement | null>;
  markUserScrollIntent: () => void;
  handleMessageScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  draft?: string;
}

export function FriendsMessageList({
  friend,
  messages,
  historyLoading,
  currentUserAvatar,
  onOpenSharedVideo,
  onOpenLocalVideo,
  sharedPlayerLoadingId,
  onMediaSettled,
  onOpenProfile,
  scrollRef,
  bottomAnchorRef,
  markUserScrollIntent,
  handleMessageScroll,
  draft,
}: FriendsMessageListProps) {
  const hasDraft = Boolean(draft && draft.trim());

  return (
    <div
      ref={scrollRef}
      onPointerDown={markUserScrollIntent}
      onTouchStart={markUserScrollIntent}
      onWheel={markUserScrollIntent}
      onScroll={handleMessageScroll}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        {historyLoading && messages.length > 0 && (
          <div className="mx-auto flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[0.68rem] text-text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            加载中
          </div>
        )}
        {messages.map((message, index) => {
          const prevMessage = index > 0 ? messages[index - 1] : null;
          const showDate = !prevMessage || !isSameMessageDate(message.createdAt, prevMessage.createdAt);
          const showTime = showDate || !prevMessage || (message.createdAt - prevMessage.createdAt) > 10 * 60 * 1000;
          const centerNotice = centerNoticeText(message);
          const framedBody = hasFramedMessageBody(message);
          return (
            <Fragment key={message.id}>
              {showTime && (
                <div className="mx-auto my-1 text-[0.68rem] text-text-muted select-none">
                  {formatMessageDividerTime(message.createdAt, showDate)}
                </div>
              )}
              {centerNotice ? (
                <div className="mx-auto max-w-[78%] rounded-full bg-surface-raised px-3 py-1 text-center text-[0.68rem] leading-relaxed text-text-muted">
                  {centerNotice}
                </div>
              ) : (
                <div
                  className={cn(
                    "flex max-w-[88%] items-start gap-2",
                    message.direction === "in" ? "mr-auto flex-row" : "ml-auto flex-row-reverse",
                  )}
                >
                  <MessageAvatar
                    friend={friend}
                    direction={message.direction || "out"}
                    currentUserAvatar={currentUserAvatar}
                    onOpenProfile={onOpenProfile}
                  />
                  <div className={cn("flex min-w-0 flex-col", message.direction === "in" ? "items-start" : "items-end")}>
                    <div className="peer/bubble relative">
                      {message.direction !== "in" && message.status === "pending" && message.imagePreviewUrl && (
                        <div className="absolute right-full top-1/2 mr-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-solid text-text-muted shadow-[0_8px_18px_rgba(15,23,42,0.12)]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "min-w-0",
                          framedBody
                            ? ""
                            : "rounded-[16px] shadow-[0_10px_20px_rgba(15,23,42,0.08)]",
                          !framedBody && (
                            message.direction === "in"
                              ? "rounded-tl-[6px] border border-border bg-surface text-text"
                              : "rounded-tr-[6px] bg-accent text-white shadow-[0_10px_20px_rgba(254,44,85,0.16)]"
                          ),
                        )}
                      >
                        <MessageBody
                          message={message}
                          onOpenSharedVideo={onOpenSharedVideo}
                          onOpenLocalVideo={onOpenLocalVideo}
                          sharedPlayerLoadingId={sharedPlayerLoadingId}
                          onMediaSettled={onMediaSettled}
                        />
                      </div>
                    </div>
                    <div
                      className={cn(
                        "mt-1 min-h-4 text-[0.62rem] transition-opacity",
                        message.status === "error"
                          ? "visible max-w-[18rem] text-danger opacity-100"
                          : "invisible text-text-muted opacity-0 peer-hover/bubble:visible peer-hover/bubble:opacity-100",
                      )}
                    >
                      {message.status === "error"
                        ? message.error || "发送失败"
                        : formatMessageTime(message.createdAt)}
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
        <div ref={bottomAnchorRef} aria-hidden="true" className="h-px w-full" />
        {hasDraft && (
          <div className="ml-auto max-w-[82%] rounded-[16px] rounded-tr-[6px] border border-accent/25 bg-accent-soft px-3 py-2 text-accent">
            <p className="whitespace-pre-wrap break-words text-[0.76rem] leading-relaxed">{draft}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBody({
  message,
  onOpenSharedVideo,
  onOpenLocalVideo,
  sharedPlayerLoadingId,
  onMediaSettled,
}: {
  message: LocalChatMessage;
  onOpenSharedVideo: (card: SharedMessageCard) => Promise<void>;
  onOpenLocalVideo: (message: LocalChatMessage) => void;
  sharedPlayerLoadingId: string;
  onMediaSettled: () => void;
}) {
  if (message.imagePreviewUrl) {
    return <ImageMessageView src={message.imagePreviewUrl} onSettled={onMediaSettled} />;
  }
  if (message.videoPreviewUrl) {
    return <LocalVideoMessageView
      message={message}
      onOpen={onOpenLocalVideo}
      onSettled={onMediaSettled}
    />;
  }
  const shared = parseSharedMessage(message);
  if (shared) {
    if (shared.kind === "image") {
      return <ImageMessageView src={shared.coverUrl} skey={shared.skey} onSettled={onMediaSettled} />;
    }
    return (
      <SharedMessageCardView
        card={shared}
        outgoing={message.direction !== "in"}
        loading={Boolean(shared.itemId && sharedPlayerLoadingId === shared.itemId)}
        onOpenSharedVideo={onOpenSharedVideo}
      />
    );
  }
  return (
    <p className="whitespace-pre-wrap break-words px-3 py-2 text-[0.76rem] leading-relaxed">
      {message.text}
    </p>
  );
}

function LocalVideoMessageView({
  message,
  onOpen,
  onSettled,
}: {
  message: LocalChatMessage;
  onOpen: (message: LocalChatMessage) => void;
  onSettled?: () => void;
}) {
  const poster = message.videoPosterUrl?.trim() || "";
  const pending = message.status === "pending";
  const sent = message.status === "sent";
  const rawProgress = Number(message.videoUploadProgress);
  const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, Math.round(rawProgress))) : 0;
  const stage = message.videoUploadStage?.trim() || (pending ? "正在上传视频" : sent ? "点击播放" : "视频发送失败");

  useEffect(() => {
    if (!poster) onSettled?.();
  }, [onSettled, poster]);

  return (
    <button
      type="button"
      disabled={!sent}
      onClick={() => {
        if (sent) onOpen(message);
      }}
      className={cn(
        "group relative block w-[min(10.6rem,42vw)] overflow-hidden rounded-[14px] bg-black text-left shadow-[0_10px_24px_rgba(0,0,0,0.22)] outline-none ring-accent/35 transition sm:w-[11.6rem]",
        sent ? "cursor-pointer hover:ring-2 focus-visible:ring-2" : "cursor-default",
      )}
      title={sent ? "打开播放器" : pending ? `${stage} ${progress}%` : stage}
      aria-label={sent ? "打开本机视频播放器" : stage}
    >
      <div className="relative aspect-[9/16] min-h-[12rem] max-h-[16.6rem] w-full overflow-hidden">
        {poster ? (
          <img
            src={poster}
            alt=""
            onLoad={onSettled}
            onError={onSettled}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(255,255,255,0.2),transparent_36%),linear-gradient(155deg,#3b3b47,#15151a_66%,#08080b)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/78 via-black/16 to-black/5" />

        {sent && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/48 text-white shadow-[0_8px_18px_rgba(0,0,0,0.3)] backdrop-blur transition-transform duration-300 group-hover:scale-110">
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            </span>
          </div>
        )}

        {pending && (
          <div className="absolute inset-0 flex flex-col justify-end bg-black/28 p-3 text-white backdrop-blur-[1px]">
            <div className="mb-2 flex items-center gap-1.5 text-[0.68rem] font-medium">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="min-w-0 flex-1 truncate">{stage}</span>
              <span className="shrink-0 tabular-nums text-white/88">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/24">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-200 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {!pending && !sent && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/38 px-3 text-center text-[0.7rem] font-medium text-white">
            {stage}
          </div>
        )}

        {!pending && (
          <div className="absolute inset-x-0 bottom-0 px-3 pb-2.5 text-[0.64rem] font-medium text-white/88">
            {sent ? "视频已发送 · 点击播放" : "视频发送失败"}
          </div>
        )}
      </div>
    </button>
  );
}

function ImageMessageView({ src, skey, onSettled }: { src: string; skey?: string; onSettled?: () => void }) {
  if (!src) return null;
  const displaySrc = /^https?:\/\//.test(src) ? mediaProxyUrl(src, "image", { skey }) : src;
  return (
    <button
      type="button"
      onClick={() => window.open(displaySrc, "_blank", "noopener,noreferrer")}
      className="block max-w-[min(12rem,52vw)] overflow-hidden rounded-[14px] bg-surface-raised outline-none ring-accent/35 transition hover:ring-2 focus-visible:ring-2"
      title="打开图片"
    >
      <img
        src={displaySrc}
        alt=""
        onLoad={onSettled}
        onError={onSettled}
        className="block max-h-48 w-auto max-w-full object-contain"
      />
    </button>
  );
}

function SharedMessageCardView({
  card,
  outgoing,
  loading,
  onOpenSharedVideo,
}: {
  card: SharedMessageCard;
  outgoing: boolean;
  loading: boolean;
  onOpenSharedVideo: (card: SharedMessageCard) => Promise<void>;
}) {
  const compact = !card.coverUrl;
  const clickable = (card.kind === "video" || card.kind === "gallery") && Boolean(card.itemId);
  const unsignedCoverUrl = unsignedMediaUrl(card.coverUrl);
  const [useUnsignedCover, setUseUnsignedCover] = useState(false);
  const coverSrc = card.coverUrl
    ? mediaProxyUrl(useUnsignedCover && unsignedCoverUrl ? unsignedCoverUrl : card.coverUrl, "image", { skey: card.skey })
    : "";
  const avatarSrc = card.avatarUrl ? mediaProxyUrl(card.avatarUrl, "image") : "";
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => {
    setUseUnsignedCover(false);
    setCoverFailed(false);
  }, [card.coverUrl]);
  const handleCoverError = () => {
    if (!useUnsignedCover && unsignedCoverUrl) {
      setUseUnsignedCover(true);
      return;
    }
    setCoverFailed(true);
  };
  const showCover = Boolean(coverSrc && !coverFailed);
  const fallbackIcon = card.kind === "location"
    ? <MapPin className="h-4 w-4 text-text-muted" />
    : card.kind === "product"
      ? <ShoppingBag className="h-4 w-4 text-text-muted" />
      : card.kind === "gallery"
        ? <Images className="h-4 w-4 text-text-muted" />
      : <MessageCircle className="h-4 w-4 text-text-muted" />;
  const fallbackCover = (
    <div className={cn(
      "flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center",
      card.kind === "product"
        ? "bg-[linear-gradient(135deg,rgba(254,44,85,0.12),rgba(255,255,255,0.96)_46%,rgba(245,158,11,0.14))]"
        : card.kind === "location"
          ? "bg-[linear-gradient(135deg,rgba(20,184,166,0.14),rgba(255,255,255,0.96)_46%,rgba(59,130,246,0.12))]"
          : "bg-surface-raised",
    )}>
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-white/85 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
        {fallbackIcon}
      </div>
      <div className="line-clamp-2 max-w-full text-[0.62rem] font-semibold leading-snug text-text-muted">
        {card.kind === "product" ? "商品" : card.kind === "location" ? "地点" : card.kind === "gallery" ? "图集" : "分享"}
      </div>
    </div>
  );
  if ((card.kind === "video" || card.kind === "gallery") && card.coverUrl) {
    const mediaContent = (
      <div className="group relative w-[min(10.6rem,42vw)] overflow-hidden rounded-[12px] bg-black text-left shadow-[0_10px_24px_rgba(0,0,0,0.22)] sm:w-[11.6rem]">
        <div className="relative w-full aspect-[9/16] max-h-[16.6rem] min-h-[12rem]">
          {showCover ? (
            <img
              src={coverSrc}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              onError={handleCoverError}
            />
          ) : (
            <div className="absolute inset-0">{fallbackCover}</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/24 to-black/5" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={cn(
              "flex items-center justify-center rounded-full bg-black/42 text-white shadow-[0_6px_12px_rgba(0,0,0,0.22)] backdrop-blur transition-transform duration-300 group-hover:scale-110",
              card.kind === "gallery" ? "h-8 gap-1.5 px-2.5" : "h-8 w-8",
            )}>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : card.kind === "gallery" ? (
                <>
                  <Images className="h-3.5 w-3.5" />
                  <span className="text-[0.62rem] font-semibold">{Math.max(card.mediaCount || 1, 1)} 张</span>
                </>
              ) : (
                <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
              )}
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
            <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-full border border-white/70 object-cover shadow-[0_3px_8px_rgba(0,0,0,0.25)]"
                />
              ) : (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15">
                  <UserRound className="h-2.5 w-2.5 text-white/85" />
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-[0.65rem] font-semibold">
                  {card.authorName || "抖音作者"}
                </div>
                <div className="text-[0.55rem] text-white/68">{card.subtitle}</div>
              </div>
            </div>
            <div className="line-clamp-3 break-words text-[0.7rem] font-semibold leading-snug text-white">
              {card.title}
            </div>
          </div>
          {loading && (
            <div className="absolute inset-0 bg-black/18" />
          )}
        </div>
      </div>
    );
    if (!clickable) return mediaContent;
    return (
      <button
        type="button"
        disabled={loading}
        onClick={() => void onOpenSharedVideo(card)}
        className="block cursor-pointer rounded-[16px] outline-none ring-accent/35 transition hover:ring-2 focus-visible:ring-2 disabled:cursor-wait"
        title={card.kind === "gallery" ? "打开图集" : "打开播放器"}
      >
        {mediaContent}
      </button>
    );
  }
  const content = (
    <div className={cn(
      compact
        ? "grid w-[min(16rem,62vw)] grid-cols-[44px_minmax(0,1fr)] overflow-hidden rounded-[14px] text-left"
        : "grid w-[min(18rem,68vw)] grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-[14px] text-left sm:w-[20rem] sm:grid-cols-[132px_minmax(0,1fr)]",
      "border border-border bg-surface-raised text-text shadow-[0_10px_20px_rgba(15,23,42,0.08)]",
    )}>
      <div className={cn("relative overflow-hidden bg-black/10", compact ? "h-full min-h-[72px]" : "h-[112px] sm:h-[132px]")}>
        {showCover ? (
          <img
            src={coverSrc}
            alt=""
            loading="lazy"
            onError={handleCoverError}
            className="h-full w-full object-cover outline outline-1 outline-black/10"
          />
        ) : (
          fallbackCover
        )}
        {avatarSrc && (
          <img
            src={avatarSrc}
            alt=""
            className="absolute bottom-1.5 right-1.5 h-5 w-5 rounded-full border border-white/80 object-cover"
          />
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35">
            <Loader2 className="h-4 w-4 animate-spin text-white" />
          </div>
        )}
      </div>
      <div className={cn("flex min-w-0 flex-col justify-between gap-2", compact ? "p-2.5" : "p-3")}>
        <div className="min-w-0">
          <div className="line-clamp-2 text-[0.66rem] font-medium leading-snug text-text-muted">
            {card.subtitle}
          </div>
          <div className={cn(
            "mt-1 break-words font-semibold leading-snug",
            compact ? "line-clamp-3 text-[0.74rem]" : "line-clamp-2 text-[0.78rem]",
          )}>
            {card.title}
          </div>
        </div>
        {card.itemId && (
          <div className="truncate text-[0.6rem] tabular-nums text-text-muted">
            {card.itemId}
          </div>
        )}
      </div>
    </div>
  );
  if (!clickable) return content;
  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => void onOpenSharedVideo(card)}
      className="block cursor-pointer rounded-[14px] outline-none ring-accent/35 transition hover:ring-2 focus-visible:ring-2 disabled:cursor-wait"
        title={card.kind === "gallery" ? "打开图集" : "打开播放器"}
    >
      {content}
    </button>
  );
}
