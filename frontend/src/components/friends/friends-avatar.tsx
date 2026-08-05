import { UserRound } from "lucide-react";
import { mediaProxyUrl } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { FriendStatusItem } from "./friends-status-types";

interface MessageAvatarProps {
  friend: FriendStatusItem;
  direction: "in" | "out";
  currentUserAvatar: string;
  onOpenProfile: (friend: FriendStatusItem) => Promise<void>;
}

export function MessageAvatar({
  friend,
  direction,
  currentUserAvatar,
  onOpenProfile,
}: MessageAvatarProps) {
  const isIncoming = direction === "in";
  const avatar = isIncoming ? friend.avatar : currentUserAvatar;
  const avatarSrc = avatar ? mediaProxyUrl(avatar, "image") : "";
  const className = cn(
    "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border outline-none ring-accent/35 transition",
    isIncoming
      ? "border-border bg-surface-raised hover:ring-2 focus-visible:ring-2"
      : "border-accent/20 bg-accent-soft text-accent",
  );
  const content = avatarSrc ? (
    <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
  ) : (
    <UserRound className="h-3.5 w-3.5" />
  );
  if (isIncoming) {
    return (
      <button type="button" aria-label="打开主页" onClick={() => void onOpenProfile(friend)} className={className}>
        {content}
      </button>
    );
  }
  return (
    <div className={className}>
      {content}
    </div>
  );
}
