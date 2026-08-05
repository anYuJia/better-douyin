import { Badge } from "@/components/ui/badge";
import { mediaProxyUrl } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { FriendListItem } from "./friends-status-types";
import { formatMessageTime } from "./friends-status-utils";

interface FriendRowProps {
  friend: FriendListItem;
  selected: boolean;
  onSelect: (friend: FriendListItem) => void;
  onOpenProfile: (friend: FriendListItem) => Promise<void>;
}

export function FriendRow({
  friend,
  selected,
  onSelect,
  onOpenProfile,
}: FriendRowProps) {
  const rightLabel = friend.latestMessageAt ? formatMessageTime(friend.latestMessageAt) : friend.lastActive;
  return (
    <button
      type="button"
      onClick={() => onSelect(friend)}
      className={cn(
        "grid w-full min-w-0 grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow,transform]",
        selected
          ? "border-accent/35 bg-accent-soft shadow-[inset_0_0_0_1px_rgba(254,44,85,0.04)]"
          : "border-border bg-surface hover:border-border-strong hover:bg-surface-raised",
      )}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label="打开主页"
        onClick={(event) => {
          event.stopPropagation();
          void onOpenProfile(friend);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          void onOpenProfile(friend);
        }}
        className="relative h-8 w-8 overflow-hidden rounded-full bg-surface-raised outline-none ring-accent/35 transition hover:ring-2 focus-visible:ring-2"
      >
        {friend.avatar ? (
          <img src={mediaProxyUrl(friend.avatar, "image")} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[0.75rem] font-bold text-text-muted">
            {(friend.remarkName || friend.nickname).slice(0, 1) || "友"}
          </div>
        )}
        <span
          className={cn(
            "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface",
            friend.online ? "bg-success" : "bg-text-muted",
          )}
        />
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[0.8rem] font-semibold text-text">
            {friend.remarkName || friend.nickname || "未知用户"}
          </span>
          <Badge variant={friend.online ? "success" : "secondary"} size="sm">
            {friend.statusText}
          </Badge>
        </div>
        <div className="mt-0.5 truncate text-[0.68rem] text-text-muted">
          {friend.previewText}
        </div>
      </div>

      <div className="flex min-w-[44px] flex-col items-end gap-1 text-right">
        <span className="text-[0.68rem] text-text-muted">{rightLabel}</span>
        {friend.unreadCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.6rem] font-bold leading-none text-white">
            {friend.unreadCount > 99 ? "99+" : friend.unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}
