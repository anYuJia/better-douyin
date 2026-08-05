import type { VideoMediaItem } from "@/lib/video-media";
import { ProgressBar } from "./player-components";

interface PlayerPlaybackBarProps {
  duration: number;
  currentTime: number;
  progressPct: number;
  mediaItems: VideoMediaItem[];
  activeMediaIndex: number;
  previewSrc: string;
  onSeek: (time: number) => void;
  onSelectMedia: (index: number) => void;
}

export function PlayerPlaybackBar({
  duration,
  currentTime,
  progressPct,
  mediaItems,
  activeMediaIndex,
  previewSrc,
  onSeek,
  onSelectMedia,
}: PlayerPlaybackBarProps) {
  return (
    <ProgressBar
      duration={duration}
      currentTime={currentTime}
      progressPct={progressPct}
      mediaItems={mediaItems}
      mediaIndex={activeMediaIndex}
      previewSrc={previewSrc}
      onSeek={onSeek}
      onSelectMedia={onSelectMedia}
    />
  );
}
