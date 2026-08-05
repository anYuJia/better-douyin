import { AnimatePresence, motion } from "framer-motion";
import { isVideoLikeMedia, type VideoMediaItem } from "@/lib/video-media";
import { PlayerStatus } from "./player-components";
import { MediaOverlays } from "./player-overlays";
import { mediaMotionVariants } from "./player-utils";
import type { VideoInfo } from "@/lib/tauri";
import { type RefObject, type SyntheticEvent } from "react";

interface PlayerMediaStageProps {
  mediaKey: string;
  mediaTransitionDirection: number;
  currentMedia: VideoMediaItem | null;
  currentMediaSrc: string;
  currentVideo: VideoInfo;
  shouldAutoPlayCurrentMedia: boolean;
  autoPlayNextVideo: boolean;
  hasMultipleMedia: boolean;
  shouldUseBgmForCurrentMedia: boolean;
  muted: boolean;
  volume: number;
  playing: boolean;
  loadState: "loading" | "ready" | "error";
  showLoadStatus: boolean;
  navigationNotice: string;

  // Refs
  setVideoElementRef: (node: HTMLVideoElement | null) => void;
  surfaceHitRef: RefObject<HTMLDivElement | null>;

  // Handlers
  handleSurfacePointerDown: (e: any) => void;
  handleSurfacePointerUp: (e: any) => void;
  handleSurfacePointerCancel: (e: any) => void;
  handleSurfaceMouseDown: (e: any) => void;
  handleSurfaceMouseUp: (e: any) => void;
  handleSurfaceTouchStart: (e: any) => void;
  handleSurfaceTouchEnd: (e: any) => void;
  handleSurfaceClick: (e: any) => void;

  // Media callbacks
  scheduleLoadTimeout: () => void;
  showBufferingSoon: () => void;
  onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onLoadedData: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onDurationChange: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onCanPlay: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onSeeking: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onSeeked: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onPlay: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onPlaying: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onPause: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onRateChange: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onEnded: () => void;
  onError: () => void;
  onImageLoad: () => void;
  onImageError: () => void;
  retryCurrentMedia: () => void;
}

export function PlayerMediaStage({
  mediaKey,
  mediaTransitionDirection,
  currentMedia,
  currentMediaSrc,
  currentVideo,
  shouldAutoPlayCurrentMedia,
  autoPlayNextVideo,
  hasMultipleMedia,
  shouldUseBgmForCurrentMedia,
  muted,
  volume,
  playing,
  loadState,
  showLoadStatus,
  navigationNotice,

  setVideoElementRef,
  surfaceHitRef,

  handleSurfacePointerDown,
  handleSurfacePointerUp,
  handleSurfacePointerCancel,
  handleSurfaceMouseDown,
  handleSurfaceMouseUp,
  handleSurfaceTouchStart,
  handleSurfaceTouchEnd,
  handleSurfaceClick,

  scheduleLoadTimeout,
  showBufferingSoon,
  onLoadedMetadata,
  onLoadedData,
  onDurationChange,
  onCanPlay,
  onTimeUpdate,
  onSeeking,
  onSeeked,
  onPlay,
  onPlaying,
  onPause,
  onRateChange,
  onEnded,
  onError,
  onImageLoad,
  onImageError,
  retryCurrentMedia,
}: PlayerMediaStageProps) {
  return (
    <div
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      onClick={(event) => event.stopPropagation()}
    >
      <AnimatePresence initial={false} custom={mediaTransitionDirection}>
        <motion.div
          key={mediaKey}
          custom={mediaTransitionDirection}
          variants={mediaMotionVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="absolute inset-0 flex items-center justify-center"
          style={{ backfaceVisibility: "hidden", contain: "layout paint", willChange: "transform" }}
        >
          {currentMedia && isVideoLikeMedia(currentMedia) && (
            <video
              ref={setVideoElementRef}
              src={currentMediaSrc}
              className="pointer-events-none h-full max-h-full w-full max-w-full object-contain"
              autoPlay={shouldAutoPlayCurrentMedia}
              loop={!hasMultipleMedia && !autoPlayNextVideo}
              playsInline
              muted={shouldUseBgmForCurrentMedia || muted || volume === 0}
              preload={hasMultipleMedia ? "auto" : "metadata"}
              onPointerDown={handleSurfacePointerDown}
              onPointerUp={handleSurfacePointerUp}
              onPointerCancel={handleSurfacePointerCancel}
              onMouseDown={handleSurfaceMouseDown}
              onMouseUp={handleSurfaceMouseUp}
              onTouchStart={handleSurfaceTouchStart}
              onTouchEnd={handleSurfaceTouchEnd}
              onTouchCancel={handleSurfaceTouchEnd}
              onClick={handleSurfaceClick}
              onLoadStart={scheduleLoadTimeout}
              onWaiting={showBufferingSoon}
              onStalled={showBufferingSoon}
              onLoadedMetadata={onLoadedMetadata}
              onLoadedData={onLoadedData}
              onDurationChange={onDurationChange}
              onCanPlay={onCanPlay}
              onTimeUpdate={onTimeUpdate}
              onSeeking={onSeeking}
              onSeeked={onSeeked}
              onPlay={onPlay}
              onPlaying={onPlaying}
              onPause={onPause}
              onRateChange={onRateChange}
              onEnded={onEnded}
              onError={onError}
            />
          )}

          {currentMedia?.type === "image" && (
            <img
              src={currentMediaSrc}
              alt={currentVideo.desc || "图片"}
              className="pointer-events-none max-h-full max-w-full object-contain"
              onPointerDown={handleSurfacePointerDown}
              onPointerUp={handleSurfacePointerUp}
              onPointerCancel={handleSurfacePointerCancel}
              onMouseDown={handleSurfaceMouseDown}
              onMouseUp={handleSurfaceMouseUp}
              onTouchStart={handleSurfaceTouchStart}
              onTouchEnd={handleSurfaceTouchEnd}
              onTouchCancel={handleSurfaceTouchEnd}
              onClick={handleSurfaceClick}
              onLoad={onImageLoad}
              onError={onImageError}
            />
          )}

          {!currentMedia && (
            <PlayerStatus
              title="没有可播放的媒体"
              message="当前作品没有返回视频或图片地址。"
              onRetry={retryCurrentMedia}
              state="error"
            />
          )}
        </motion.div>
      </AnimatePresence>

      <div
        ref={surfaceHitRef}
        role="button"
        tabIndex={0}
        className="absolute inset-0 z-10 cursor-default bg-black/[0.001]"
        aria-label={playing ? "暂停" : "播放"}
        onClick={handleSurfaceClick}
      />

      <MediaOverlays
        loadState={loadState}
        showLoadStatus={showLoadStatus}
        playing={playing}
        hasCurrentMedia={Boolean(currentMedia)}
        isVideoLikeMedia={currentMedia ? isVideoLikeMedia(currentMedia) : false}
        navigationNotice={navigationNotice}
        onRetry={retryCurrentMedia}
      />
    </div>
  );
}
