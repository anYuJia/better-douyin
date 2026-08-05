import { Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { PlayerIconButton } from "./player-components";
import type { PlayerPanel } from "./player-utils";

interface VolumePanelProps {
  openPanel: PlayerPanel | null;
  muted: boolean;
  volume: number;
  effectiveVolume: number;
  onToggleMute: (event: ReactMouseEvent) => void;
  onVolumeChange: (nextVolume: number) => void;
  onTogglePanel: (panel: PlayerPanel, event: ReactMouseEvent) => void;
  onOpenPanelOnPointerEnter: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onClosePanelOnPointerLeave: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onOpenToolPanel: (panel: PlayerPanel) => void;
  onSchedulePanelClose: (panel?: PlayerPanel) => void;
  onOpenPanelOnPointerDown: (panel: PlayerPanel, event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function VolumePanel({
  openPanel,
  muted,
  volume,
  effectiveVolume,
  onToggleMute,
  onVolumeChange,
  onTogglePanel,
  onOpenPanelOnPointerEnter,
  onClosePanelOnPointerLeave,
  onOpenToolPanel,
  onSchedulePanelClose,
  onOpenPanelOnPointerDown,
}: VolumePanelProps) {
  return (
    <div
      className="relative shrink-0"
      onPointerEnter={(event) => onOpenPanelOnPointerEnter("volume", event)}
      onPointerLeave={(event) => onClosePanelOnPointerLeave("volume", event)}
      onMouseEnter={() => onOpenToolPanel("volume")}
      onMouseLeave={() => onSchedulePanelClose("volume")}
    >
      <PlayerIconButton
        label="音量"
        onClick={(event) => onTogglePanel("volume", event)}
        onPointerDown={(event) => onOpenPanelOnPointerDown("volume", event)}
        active={openPanel === "volume"}
      >
        {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </PlayerIconButton>
      <AnimatePresence>
        {openPanel === "volume" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-9 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[#141414]/95 px-3 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            onPointerEnter={(event) => onOpenPanelOnPointerEnter("volume", event)}
            onPointerLeave={(event) => onClosePanelOnPointerLeave("volume", event)}
            onMouseEnter={() => onOpenToolPanel("volume")}
            onMouseLeave={() => onSchedulePanelClose("volume")}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={onToggleMute}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:text-white/70"
              aria-label={muted ? "取消静音" : "静音"}
            >
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={effectiveVolume}
              onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
              className="h-1 w-[100px] cursor-pointer accent-accent"
              aria-label="音量"
            />
            <span className="min-w-9 text-center text-[0.78rem] font-medium tabular-nums text-white/90">
              {effectiveVolume}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
