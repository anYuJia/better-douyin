import { Download, Loader2, Music, Pause, Play } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { PlayerIconButton } from "./player-components";
import type { PlayerPanel } from "./player-utils";

interface DownloadPanelProps {
  openPanel: PlayerPanel | null;
  downloadSubmitting: boolean;
  hasDownloadHandler: boolean;
  onDownloadCurrent: (event: ReactMouseEvent) => void;
  onCopyCurrentMediaUrl: (event: ReactMouseEvent) => void;
  onTogglePanel: (panel: PlayerPanel, event: ReactMouseEvent) => void;
  onOpenPanelOnPointerEnter: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onClosePanelOnPointerLeave: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onOpenToolPanel: (panel: PlayerPanel) => void;
  onSchedulePanelClose: (panel?: PlayerPanel) => void;
}

export function DownloadPanel({
  openPanel,
  downloadSubmitting,
  hasDownloadHandler,
  onDownloadCurrent,
  onCopyCurrentMediaUrl,
  onTogglePanel,
  onOpenPanelOnPointerEnter,
  onClosePanelOnPointerLeave,
  onOpenToolPanel,
  onSchedulePanelClose,
}: DownloadPanelProps) {
  return (
    <div
      className="relative shrink-0"
      onPointerEnter={(event) => onOpenPanelOnPointerEnter("download", event)}
      onPointerLeave={(event) => onClosePanelOnPointerLeave("download", event)}
      onMouseEnter={() => onOpenToolPanel("download")}
      onMouseLeave={() => onSchedulePanelClose("download")}
    >
      <PlayerIconButton
        label={downloadSubmitting ? "正在加入下载" : "下载作品"}
        onClick={onDownloadCurrent}
        active={openPanel === "download" || downloadSubmitting}
        disabled={!hasDownloadHandler || downloadSubmitting}
      >
        {downloadSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </PlayerIconButton>
      <AnimatePresence>
        {openPanel === "download" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-9 right-0 z-40 w-[160px] rounded-xl bg-[#141414]/95 p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            onPointerEnter={(event) => onOpenPanelOnPointerEnter("download", event)}
            onPointerLeave={(event) => onClosePanelOnPointerLeave("download", event)}
            onMouseEnter={() => onOpenToolPanel("download")}
            onMouseLeave={() => onSchedulePanelClose("download")}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={!hasDownloadHandler || downloadSubmitting}
                onClick={onDownloadCurrent}
                className="flex h-8 items-center justify-center gap-1 rounded-md bg-accent/18 text-[0.72rem] font-semibold text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {downloadSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {downloadSubmitting ? "正在加入" : "下载作品"}
              </button>
              <button
                type="button"
                onClick={onCopyCurrentMediaUrl}
                className="flex h-8 items-center justify-center rounded-md bg-white/[0.08] text-[0.72rem] font-semibold text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              >
                复制播放地址
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface MusicPanelProps {
  openPanel: PlayerPanel | null;
  musicUrl: string;
  bgmPlaying: boolean;
  bgmProxyUrl: string;
  bgmDownloadSubmitting: boolean;
  canDownloadBgm: boolean;
  onToggleBgm: (event: ReactMouseEvent) => void;
  onDownloadBgm: (event: ReactMouseEvent) => void;
  onTogglePanel: (panel: PlayerPanel, event: ReactMouseEvent) => void;
  onOpenPanelOnPointerEnter: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onClosePanelOnPointerLeave: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onOpenToolPanel: (panel: PlayerPanel) => void;
  onSchedulePanelClose: (panel?: PlayerPanel) => void;
  onOpenPanelOnPointerDown: (panel: PlayerPanel, event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function MusicPanel({
  openPanel,
  musicUrl,
  bgmPlaying,
  bgmProxyUrl,
  bgmDownloadSubmitting,
  canDownloadBgm,
  onToggleBgm,
  onDownloadBgm,
  onTogglePanel,
  onOpenPanelOnPointerEnter,
  onClosePanelOnPointerLeave,
  onOpenToolPanel,
  onSchedulePanelClose,
  onOpenPanelOnPointerDown,
}: MusicPanelProps) {
  return (
    <div
      className="relative shrink-0"
      onPointerEnter={(event) => onOpenPanelOnPointerEnter("music", event)}
      onPointerLeave={(event) => onClosePanelOnPointerLeave("music", event)}
      onMouseEnter={() => onOpenToolPanel("music")}
      onMouseLeave={() => onSchedulePanelClose("music")}
    >
      <PlayerIconButton
        label="背景音乐"
        onClick={(event) => onTogglePanel("music", event)}
        onPointerDown={(event) => onOpenPanelOnPointerDown("music", event)}
        active={openPanel === "music"}
      >
        <Music className="h-4 w-4" />
      </PlayerIconButton>
      <AnimatePresence>
        {openPanel === "music" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-9 right-0 z-40 w-[160px] rounded-xl bg-[#141414]/95 p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            onPointerEnter={(event) => onOpenPanelOnPointerEnter("music", event)}
            onPointerLeave={(event) => onClosePanelOnPointerLeave("music", event)}
            onMouseEnter={() => onOpenToolPanel("music")}
            onMouseLeave={() => onSchedulePanelClose("music")}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            {musicUrl ? (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={onToggleBgm}
                  className="flex h-8 items-center justify-center gap-1 rounded-md bg-accent/18 text-[0.72rem] font-semibold text-accent transition-colors hover:bg-accent/25"
                >
                  {bgmPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                  {bgmPlaying ? "暂停 BGM" : "播放 BGM"}
                </button>
                <button
                  type="button"
                  disabled={bgmDownloadSubmitting || !bgmProxyUrl || !canDownloadBgm}
                  className="flex h-8 items-center justify-center gap-1 rounded-md bg-white/[0.08] text-[0.72rem] font-semibold text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                  onClick={onDownloadBgm}
                >
                  {bgmDownloadSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {bgmDownloadSubmitting ? "加入中" : "下载"}
                </button>
              </div>
            ) : (
              <div className="rounded-md bg-white/[0.06] px-2 py-2 text-[0.72rem] text-white/55">
                当前作品没有返回音频地址
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
