import { Check, Loader2, Share2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { mediaProxyUrl, type ShareFriend } from "@/lib/tauri";
import { PlayerIconButton } from "./player-components";
import type { PlayerPanel } from "./player-utils";

interface SharePanelProps {
  openPanel: PlayerPanel | null;
  shareFriends: ShareFriend[];
  shareFriendsLoading: boolean;
  shareFriendsError: string;
  shareSendingFriendKey: string;
  shareSentFriendKeys: Set<string>;
  onShareFriendClick: (friend: ShareFriend, event: ReactMouseEvent) => void;
  onTogglePanel: (panel: PlayerPanel, event: ReactMouseEvent) => void;
  onOpenPanelOnPointerEnter: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onClosePanelOnPointerLeave: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onOpenToolPanel: (panel: PlayerPanel) => void;
  onSchedulePanelClose: (panel?: PlayerPanel) => void;
  onOpenPanelOnPointerDown: (panel: PlayerPanel, event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function SharePanel({
  openPanel,
  shareFriends,
  shareFriendsLoading,
  shareFriendsError,
  shareSendingFriendKey,
  shareSentFriendKeys,
  onShareFriendClick,
  onTogglePanel,
  onOpenPanelOnPointerEnter,
  onClosePanelOnPointerLeave,
  onOpenToolPanel,
  onSchedulePanelClose,
  onOpenPanelOnPointerDown,
}: SharePanelProps) {
  return (
    <div
      className="relative shrink-0"
      onPointerEnter={(event) => onOpenPanelOnPointerEnter("share", event)}
      onPointerLeave={(event) => onClosePanelOnPointerLeave("share", event)}
      onMouseEnter={() => onOpenToolPanel("share")}
      onMouseLeave={() => onSchedulePanelClose("share")}
    >
      <PlayerIconButton
        label="分享"
        onClick={(event) => onTogglePanel("share", event)}
        onPointerDown={(event) => onOpenPanelOnPointerDown("share", event)}
        active={openPanel === "share"}
      >
        <Share2 className="h-4 w-4" />
      </PlayerIconButton>
      <AnimatePresence>
        {openPanel === "share" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-9 right-0 z-40 w-[268px] overflow-hidden rounded-xl bg-[#141414]/95 shadow-[0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            onPointerEnter={(event) => onOpenPanelOnPointerEnter("share", event)}
            onPointerLeave={(event) => onClosePanelOnPointerLeave("share", event)}
            onMouseEnter={() => onOpenToolPanel("share")}
            onMouseLeave={() => onSchedulePanelClose("share")}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="border-b border-white/[0.08] px-3 py-2">
              <div className="text-[0.74rem] font-semibold text-white/85">分享给好友</div>
              <div className="mt-0.5 text-[0.66rem] text-white/42">点击好友即可发送</div>
            </div>
            <div className="share-friends-scroll max-h-[320px] overflow-y-auto p-1.5">
              {shareFriendsLoading ? (
                <div className="flex h-20 items-center justify-center gap-2 text-[0.72rem] text-white/60">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在获取好友
                </div>
              ) : shareFriendsError ? (
                <div className="rounded-md bg-white/[0.06] px-2 py-2 text-[0.72rem] leading-5 text-white/60">
                  {shareFriendsError}
                </div>
              ) : shareFriends.length === 0 ? (
                <div className="rounded-md bg-white/[0.06] px-2 py-2 text-[0.72rem] text-white/55">
                  暂无可分享好友
                </div>
              ) : (
                shareFriends.slice(0, 20).map((friend) => {
                  const avatar = friend.avatar_thumb || friend.avatar_medium;
                  const subtitle = friend.unique_id || friend.short_id || friend.uid;
                  const friendKey = friend.sec_uid || friend.uid;
                  const sending = shareSendingFriendKey === friendKey;
                  const sent = shareSentFriendKeys.has(friendKey);
                  return (
                    <button
                      key={friendKey}
                      type="button"
                      onClick={(event) => onShareFriendClick(friend, event)}
                      disabled={Boolean(shareSendingFriendKey)}
                      className="flex h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-white/[0.08] disabled:cursor-default disabled:opacity-70"
                    >
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white/[0.08]">
                        {avatar ? (
                          <img
                            src={mediaProxyUrl(avatar, "image")}
                            alt={friend.nickname}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-accent/30 text-[0.72rem] font-bold text-white">
                            {friend.nickname.slice(0, 1)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[0.78rem] font-semibold text-white/90">
                          {friend.nickname}
                        </div>
                        {subtitle && (
                          <div className="truncate text-[0.66rem] text-white/42">
                            {subtitle}
                          </div>
                        )}
                      </div>
                      {sending ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/60" />
                      ) : sent ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                      ) : friend.is_recent_share && (
                        <span className="shrink-0 rounded-full bg-accent/18 px-1.5 py-0.5 text-[0.62rem] font-semibold text-accent">
                          最近
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
