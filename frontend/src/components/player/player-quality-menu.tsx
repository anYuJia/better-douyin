import { Check, Gauge } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import type { VideoQualityOption } from "@/lib/video-media";
import { PlayerIconButton } from "./player-components";
import type { PlayerPanel } from "./player-utils";

interface QualityPanelProps {
  openPanel: PlayerPanel | null;
  qualityOptions: VideoQualityOption[];
  activeQualityOption: VideoQualityOption | null;
  showQualityControl: boolean;
  onQualityChange: (qualityKey: string, event: ReactMouseEvent) => void;
  onTogglePanel: (panel: PlayerPanel, event: ReactMouseEvent) => void;
  onOpenPanelOnPointerEnter: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onClosePanelOnPointerLeave: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onOpenToolPanel: (panel: PlayerPanel) => void;
  onSchedulePanelClose: (panel?: PlayerPanel) => void;
  onOpenPanelOnPointerDown: (panel: PlayerPanel, event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function QualityPanel({
  openPanel,
  qualityOptions,
  activeQualityOption,
  showQualityControl,
  onQualityChange,
  onTogglePanel,
  onOpenPanelOnPointerEnter,
  onClosePanelOnPointerLeave,
  onOpenToolPanel,
  onSchedulePanelClose,
  onOpenPanelOnPointerDown,
}: QualityPanelProps) {
  if (!showQualityControl) return null;

  return (
    <div
      className="relative shrink-0"
      onPointerEnter={(event) => onOpenPanelOnPointerEnter("quality", event)}
      onPointerLeave={(event) => onClosePanelOnPointerLeave("quality", event)}
      onMouseEnter={() => onOpenToolPanel("quality")}
      onMouseLeave={() => onSchedulePanelClose("quality")}
    >
      <PlayerIconButton
        label={`画质 ${activeQualityOption?.label || "自动"}`}
        onClick={(event) => onTogglePanel("quality", event)}
        onPointerDown={(event) => onOpenPanelOnPointerDown("quality", event)}
        active={openPanel === "quality"}
      >
        <Gauge className="h-4 w-4" />
      </PlayerIconButton>
      <AnimatePresence>
        {openPanel === "quality" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-9 left-1/2 z-40 flex w-[160px] -translate-x-1/2 flex-col gap-1 rounded-xl bg-[#141414]/95 p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            onPointerEnter={(event) => onOpenPanelOnPointerEnter("quality", event)}
            onPointerLeave={(event) => onClosePanelOnPointerLeave("quality", event)}
            onMouseEnter={() => onOpenToolPanel("quality")}
            onMouseLeave={() => onSchedulePanelClose("quality")}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-1.5 pb-1">
              <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-white/45">
                画质
              </span>
              <span className="text-[0.68rem] font-bold tabular-nums text-accent">
                {activeQualityOption?.label || "自动"}
              </span>
            </div>
            {qualityOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={(event) => onQualityChange(option.key, event)}
                className={cn(
                  "flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-white/12",
                  option.key === activeQualityOption?.key && "bg-accent/18 text-accent"
                )}
              >
                <span className="min-w-0 flex-1 text-[0.78rem] font-bold tabular-nums">
                  {option.label}
                </span>
                {option.key === activeQualityOption?.key && (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
