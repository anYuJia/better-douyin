import type { VideoInfo } from "@/lib/tauri";

interface PlayerDescriptionProps {
  currentVideo: VideoInfo;
}

export function PlayerDescription({ currentVideo }: PlayerDescriptionProps) {
  return (
    <p className="mt-1 line-clamp-2 text-[0.82rem] leading-[1.32] text-white/90 drop-shadow-md">
      {currentVideo.desc || "无描述"}
    </p>
  );
}
