import { motion } from "framer-motion";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Clock, Download, Eye, Heart, Star, UserRound } from "lucide-react";
import { VideoCover } from "@/components/media/video-cover";
import { cancelVideoPrewarm, prewarmVideoForPlayback } from "@/lib/media-prewarm";
import { cn, formatDuration, formatTime } from "@/lib/utils";
import { mediaProxyUrl, type VideoInfo } from "@/lib/tauri";
import { getVideoDurationSeconds } from "@/lib/video-media";

interface VideoCardProps {
  video: VideoInfo;
  index?: number;
  onSelect?: (video: VideoInfo) => void;
  onDetail?: (video: VideoInfo) => void;
  onDownload?: (video: VideoInfo) => void;
  onAuthor?: (video: VideoInfo) => void;
  authorLoading?: boolean;
  selected?: boolean;
  animate?: boolean;
}

export const VIDEO_CARD_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3";
export const VIDEO_CARD_HEIGHT_CLASS = "h-[372px]";
export const VIDEO_CARD_COVER_CLASS = "h-full";
export const VIDEO_CARD_BODY_CLASS = "hidden";

export function VideoCard({
  video,
  index = 0,
  onSelect,
  onDetail,
  onDownload,
  onAuthor,
  authorLoading,
  selected,
  animate = false,
}: VideoCardProps) {
  const Card = animate ? motion.div : "div";
  const authorLabel = video.author?.nickname ? `@${video.author.nickname}` : "";
  const authorAvatar = video.author?.avatar_thumb || video.author?.avatar_medium;
  const durationSeconds = getVideoDurationSeconds(video);
  const durationLabel = durationSeconds > 0 ? formatDuration(durationSeconds) : "";
  const authorMeta = authorLabel || formatTime(video.create_time);
  const actionButtonClass =
    "flex h-7 w-7 items-center justify-center rounded-full text-white/82 transition-[background-color,color,transform,opacity] duration-[var(--duration-fast)] hover:bg-white/18 hover:text-white active:scale-[0.94] disabled:cursor-default disabled:opacity-45";

  const handleCardClick = () => {
    prewarmVideoForPlayback(video, { mode: "playback" });
    onSelect?.(video);
  };

  const stopAndRun = (
    event: ReactMouseEvent,
    action: ((video: VideoInfo) => void) | undefined
  ) => {
    event.stopPropagation();
    action?.(video);
  };

  return (
    <Card
      {...(animate
        ? {
            initial: { opacity: 0, y: 12 },
            animate: { opacity: 1, y: 0 },
            transition: { delay: index * 0.05, type: "spring" as const, stiffness: 350, damping: 28 },
          }
        : {})}
      style={{ breakInside: "avoid" }}
      onClick={handleCardClick}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        prewarmVideoForPlayback(video);
      }}
      onPointerLeave={() => cancelVideoPrewarm(video)}
      onPointerDown={() => prewarmVideoForPlayback(video, { mode: "playback" })}
      onPointerCancel={() => cancelVideoPrewarm(video)}
      onBlur={() => cancelVideoPrewarm(video)}
      onFocus={() => prewarmVideoForPlayback(video)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleCardClick();
        }
      }}
      tabIndex={0}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-[var(--radius-xl)] bg-surface-solid/90 shadow-sm",
        VIDEO_CARD_HEIGHT_CLASS,
        "border border-transparent transition-[box-shadow,border-color,background-color] duration-[var(--duration-base)] ease-[var(--ease-spring)]",
        "hover:border-border-strong hover:shadow-md",
        selected && "border-accent shadow-[var(--shadow-glow)]"
      )}
    >
      <VideoCover
        video={video}
        className={VIDEO_CARD_COVER_CLASS}
        priority={index < 8}
        showDuration={false}
        showPlayOverlay={false}
        showStats={false}
      />

      {(video.is_liked || video.is_collected) && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-1">
          {video.is_liked && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/55 text-accent shadow-sm backdrop-blur-md" title="已点赞">
              <Heart className="h-3.5 w-3.5 fill-current" />
            </span>
          )}
          {video.is_collected && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/55 text-warning shadow-sm backdrop-blur-md" title="已收藏">
              <Star className="h-3.5 w-3.5 fill-current" />
            </span>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/58 to-transparent px-3 pb-3 pt-24 text-white">
        <p className="mb-3 break-words pr-10 text-[0.83rem] font-medium leading-[1.35] text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.7)] line-clamp-3">
          {video.desc || "无文案"}
        </p>

        <div className="flex items-end justify-between gap-2">
          <button
            type="button"
            className={cn(
              "pointer-events-auto flex min-w-0 items-center gap-2 rounded-full py-0.5 pr-2 text-left transition-[background-color,opacity] duration-[var(--duration-fast)]",
              onAuthor && video.author?.sec_uid && "hover:bg-white/10",
              (!onAuthor || !video.author?.sec_uid || authorLoading) && "cursor-default"
            )}
            onClick={(event) => stopAndRun(event, onAuthor)}
            disabled={!onAuthor || !video.author?.sec_uid || authorLoading}
            title={video.author?.sec_uid ? "进入作者主页" : "作者信息不可用"}
            aria-label="进入作者主页"
          >
            {authorLoading ? (
              <span className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-white/80 border-t-transparent" />
            ) : authorAvatar ? (
              <img
                src={mediaProxyUrl(authorAvatar, "image")}
                alt={authorLabel}
                className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/45"
              />
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/16 text-white ring-1 ring-white/30">
                <UserRound className="h-3.5 w-3.5" />
              </span>
            )}
            <span className="min-w-0 truncate text-[0.7rem] font-semibold text-white/92 drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)]">
              {authorMeta || "未知作者"}
            </span>
          </button>

          {durationLabel && (
            <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-black/45 px-2 py-1 text-[0.68rem] font-semibold text-white shadow-sm backdrop-blur-md">
              <Clock className="h-3 w-3" />
              {durationLabel}
            </div>
          )}
        </div>
      </div>

      <div
        className="absolute right-2.5 top-11 z-20 flex flex-col overflow-hidden rounded-full border border-white/14 bg-black/35 p-0.5 shadow-[0_14px_34px_rgba(0,0,0,0.24)] ring-1 ring-black/15 backdrop-blur-xl transition-[opacity,transform] duration-[var(--duration-base)] ease-[var(--ease-spring)] sm:translate-x-1 sm:opacity-0 sm:group-hover:translate-x-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-x-0 sm:group-focus-within:opacity-100"
        aria-label="视频操作"
      >
        <button
          type="button"
          className={actionButtonClass}
          onClick={(event) => stopAndRun(event, onAuthor)}
          disabled={!onAuthor || !video.author?.sec_uid || authorLoading}
          title={video.author?.sec_uid ? "进入作者主页" : "作者信息不可用"}
          aria-label="进入作者主页"
        >
          {authorLoading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <UserRound className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          className={actionButtonClass}
          onClick={(event) => stopAndRun(event, onDetail)}
          disabled={!onDetail}
          title="详情"
          aria-label="查看详情"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={actionButtonClass}
          onClick={(event) => stopAndRun(event, onDownload)}
          disabled={!onDownload}
          title="下载"
          aria-label="下载作品"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
    </Card>
  );
}
