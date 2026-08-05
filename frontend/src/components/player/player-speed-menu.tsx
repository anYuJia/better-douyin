import { AnimatePresence, motion } from "framer-motion";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { PlayerIconButton } from "./player-components";
import type { PlayerPanel } from "./player-utils";
import { PLAYBACK_RATES } from "./player-utils";

interface RatePanelProps {
  openPanel: PlayerPanel | null;
  playbackRate: number;
  onPlaybackRateChange: (rate: number, event: ReactMouseEvent) => void;
  onTogglePanel: (panel: PlayerPanel, event: ReactMouseEvent) => void;
  onOpenPanelOnPointerEnter: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onClosePanelOnPointerLeave: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onOpenToolPanel: (panel: PlayerPanel) => void;
  onSchedulePanelClose: (panel?: PlayerPanel) => void;
  onOpenPanelOnPointerDown: (panel: PlayerPanel, event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function RatePanel({
  openPanel,
  playbackRate,
  onPlaybackRateChange,
  onTogglePanel,
  onOpenPanelOnPointerEnter,
  onClosePanelOnPointerLeave,
  onOpenToolPanel,
  onSchedulePanelClose,
  onOpenPanelOnPointerDown,
}: RatePanelProps) {
  return (
    <div
      className="relative shrink-0"
      onPointerEnter={(event) => onOpenPanelOnPointerEnter("rate", event)}
      onPointerLeave={(event) => onClosePanelOnPointerLeave("rate", event)}
      onMouseEnter={() => onOpenToolPanel("rate")}
      onMouseLeave={() => onSchedulePanelClose("rate")}
    >
      <PlayerIconButton
        label="倍速"
        onClick={(event) => onTogglePanel("rate", event)}
        onPointerDown={(event) => onOpenPanelOnPointerDown("rate", event)}
        active={openPanel === "rate"}
      >
        <span className="text-[0.78rem] font-semibold tabular-nums">{playbackRate}x</span>
      </PlayerIconButton>
      <AnimatePresence>
        {openPanel === "rate" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-9 left-1/2 z-40 flex max-w-[200px] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl bg-[#141414]/95 p-2 shadow-[0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            onPointerEnter={(event) => onOpenPanelOnPointerEnter("rate", event)}
            onPointerLeave={(event) => onClosePanelOnPointerLeave("rate", event)}
            onMouseEnter={() => onOpenToolPanel("rate")}
            onMouseLeave={() => onSchedulePanelClose("rate")}
            onClick={(event) => event.stopPropagation()}
          >
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={(event) => onPlaybackRateChange(rate, event)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[0.72rem] font-medium text-white/70 transition-colors hover:bg-white/12 hover:text-white",
                  rate === playbackRate && "bg-accent/20 text-accent"
                )}
              >
                {rate}x
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
