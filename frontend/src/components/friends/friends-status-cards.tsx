import type { ElementType } from "react";
import { cn } from "@/lib/utils";

interface MetricProps {
  label: string;
  value: number;
  icon: ElementType;
  tone?: "default" | "success" | "muted";
}

export function Metric({
  label,
  value,
  icon: Icon,
  tone = "default",
}: MetricProps) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[0.68rem] text-text-muted">
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "success" && "text-success",
            tone === "muted" && "text-text-muted",
          )}
        />
        {label}
      </div>
      <div className="mt-0.5 text-[1rem] font-bold tabular-nums text-text">{value}</div>
    </div>
  );
}
