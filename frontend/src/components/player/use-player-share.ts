import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getShareFriends, sendFriendVideoShare, type ShareFriend, type VideoInfo } from "@/lib/tauri";
import type { PlayerPanel } from "./player-types";

interface UsePlayerShareProps {
  currentVideo: VideoInfo | null;
  openPanel: PlayerPanel | null;
  showNavigationNotice: (message: string) => void;
}

export function usePlayerShare({
  currentVideo,
  openPanel,
  showNavigationNotice,
}: UsePlayerShareProps) {
  const [shareFriends, setShareFriends] = useState<ShareFriend[]>([]);
  const [shareFriendsLoading, setShareFriendsLoading] = useState(false);
  const [shareFriendsError, setShareFriendsError] = useState("");
  const [shareFriendsLoaded, setShareFriendsLoaded] = useState(false);
  const [shareSendingFriendKey, setShareSendingFriendKey] = useState("");
  const [shareSentFriendKeys, setShareSentFriendKeys] = useState<Set<string>>(() => new Set());

  const loadShareFriends = useCallback(async () => {
    if (shareFriendsLoading || shareFriendsLoaded) return;
    setShareFriendsLoading(true);
    setShareFriendsError("");
    try {
      const result = await getShareFriends(50);
      if (!result.success) {
        throw new Error(result.message || "获取好友列表失败");
      }
      setShareFriends(Array.isArray(result.friends) ? result.friends : []);
      setShareFriendsLoaded(true);
    } catch (error) {
      setShareFriendsError(error instanceof Error ? error.message : "获取好友列表失败");
    } finally {
      setShareFriendsLoading(false);
    }
  }, [shareFriendsLoaded, shareFriendsLoading]);

  const handleShareFriendClick = useCallback(async (friend: ShareFriend, event: ReactMouseEvent) => {
    event.stopPropagation();
    if (!currentVideo || shareSendingFriendKey) return;
    const toUserId = String(friend.uid || "").trim();
    if (!toUserId) {
      showNavigationNotice("这个好友缺少 uid，暂时无法分享");
      return;
    }
    const friendKey = friend.sec_uid || friend.uid;
    setShareSendingFriendKey(friendKey);
    try {
      const result = await sendFriendVideoShare({ toUserId, video: currentVideo });
      if (!result.success) {
        throw new Error(result.message || "分享失败");
      }
      setShareSentFriendKeys((prev) => {
        const next = new Set(prev);
        next.add(friendKey);
        return next;
      });
      showNavigationNotice(friend.nickname ? `已分享给 ${friend.nickname}` : "已分享给好友");
    } catch (error) {
      showNavigationNotice(error instanceof Error ? error.message : "分享失败");
    } finally {
      setShareSendingFriendKey("");
    }
  }, [currentVideo, shareSendingFriendKey, showNavigationNotice]);

  useEffect(() => {
    if (openPanel !== "share") return;
    void loadShareFriends();
  }, [openPanel, loadShareFriends]);

  return {
    shareFriends,
    shareFriendsLoading,
    shareFriendsError,
    shareSendingFriendKey,
    shareSentFriendKeys,
    loadShareFriends,
    handleShareFriendClick,
  };
}
