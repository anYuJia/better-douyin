import { Play, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { PlayerStatus } from "./player-components";

interface TopCloseOverlayProps {
  onClose: () => void;
}

export function TopCloseOverlay({ onClose }: TopCloseOverlayProps) {
  return (
    <div
      className="absolute inset-x-0 top-0 z-30 flex items-center bg-gradient-to-b from-black/70 to-transparent px-5 py-4"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        onClick={onClose}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-[background-color,transform] hover:bg-white/20 active:scale-[0.96]"
        aria-label="关闭播放器"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

interface MediaOverlaysProps {
  loadState: "loading" | "ready" | "error";
  showLoadStatus: boolean;
  playing: boolean;
  hasCurrentMedia: boolean;
  isVideoLikeMedia: boolean;
  navigationNotice: string;
  onRetry: (event?: React.MouseEvent) => void;
}

export function MediaOverlays({
  loadState,
  showLoadStatus,
  playing,
  hasCurrentMedia,
  isVideoLikeMedia,
  navigationNotice,
  onRetry,
}: MediaOverlaysProps) {
  return (
    <>
      {loadState === "loading" && showLoadStatus && hasCurrentMedia && isVideoLikeMedia && (
        <PlayerStatus title="正在加载媒体..." message="正在通过本地代理拉取播放地址" />
      )}
      {loadState === "error" && hasCurrentMedia && (
        <PlayerStatus
          title="媒体加载失败"
          message="可以重试，或打开详情复制原始媒体链接。"
          state="error"
          onRetry={onRetry}
        />
      )}

      {!playing && loadState === "ready" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/15 shadow-[0_18px_52px_rgba(0,0,0,0.4)] backdrop-blur-md">
            <Play className="ml-1 h-8 w-8 fill-white" />
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {navigationNotice && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute left-1/2 top-[44%] z-20 -translate-x-1/2 rounded-full bg-black/58 px-4 py-2 text-[0.82rem] font-semibold text-white shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-md"
          >
            {navigationNotice}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
