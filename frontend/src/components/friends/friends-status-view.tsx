import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Loader2, RefreshCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineStatus } from "@/components/common/page-state";
import { Textarea } from "@/components/ui/textarea";
import { FullscreenPlayer } from "@/components/player/lazy-fullscreen-player";
import { useDownloads } from "@/hooks/use-downloads";
import {
  getAccounts,
  getConfig,
  getFriendOnlineStatus,
  getUserDetail,
  getVideoDetail,
  listenEvent,
  saveConfig,
  verifyCookie,
} from "@/lib/tauri";
import {
  COOKIE_LOGIN_STATUS_EVENT,
  type CookieLoginStatusDetail,
} from "@/lib/app-events";
import { videoAuthorToUserInfo } from "@/lib/video-author";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useSearchStore } from "@/stores/search-store";
import type { FollowingUser, UserInfo, VideoInfo } from "@/lib/contracts";
import {
  COOKIE_REQUIRED_PATTERN,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  MIN_BACKGROUND_REFRESH_INTERVAL_MS,
  type FriendListItem,
  type FriendStatusItem,
  type LocalChatMessage,
  type SharedMessageCard,
} from "./friends-status-types";
import {
  readCurrentUserAvatar,
  readFriendStatusInput,
  writeCurrentUserAvatar,
  writeFriendNameCache,
  writeFriendStatusInput,
} from "./friends-local-storage";
import {
  extractIds,
  formatUpdateTime,
  latestChatMessage,
  mapResponse,
  messagePreviewText,
  stringField,
} from "./friends-status-utils";
import { ChatWorkspace } from "./friends-status-components";
import { FriendListPanel } from "./friends-list-panel";
import { FollowingListDialog } from "./following-list-dialog";
import { useFriendsChat } from "./use-friends-chat";

const CONTACT_PAGE_SIZE = 20;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function dataArray(value: unknown) {
  return isPlainRecord(value) && Array.isArray(value.data) ? value.data : [];
}

function mergeFriendStatusResponse(current: any, result: any, append: boolean) {
  if (!append || !current) return result;
  const mergeSection = (left: unknown, right: unknown) => ({
    ...(isPlainRecord(left) ? left : {}),
    ...(isPlainRecord(right) ? right : {}),
    data: [...dataArray(left), ...dataArray(right)],
  });
  return {
    ...result,
    sec_user_ids: Array.from(new Set([...(current.sec_user_ids || []), ...(result.sec_user_ids || [])])),
    all_sec_user_ids: result.all_sec_user_ids || current.all_sec_user_ids,
    user_info: mergeSection(current.user_info, result.user_info),
    active_status: mergeSection(current.active_status, result.active_status),
  };
}

function buildLocalVideoPlayerItem(message: LocalChatMessage): VideoInfo | null {
  const source = String(message.videoPreviewUrl || "").trim();
  if (!source) return null;
  const poster = String(message.videoPosterUrl || "").trim();

  return {
    // Keep this blank intentionally. FullscreenPlayer treats a non-empty aweme id
    // as a remote work and would fetch relation/detail data for it.
    aweme_id: "",
    desc: "本机发送的视频",
    create_time: Math.floor(message.createdAt / 1000),
    author: {
      uid: "",
      sec_uid: "",
      nickname: "本机视频",
      avatar_thumb: "",
      avatar_medium: "",
      signature: "",
      follower_count: 0,
      following_count: 0,
      aweme_count: 0,
      favoriting_count: 0,
      is_follow: false,
      follow_status: 0,
      verify_status: 0,
      unique_id: "",
    },
    video: {
      preview_addr: source,
      play_addr: source,
      play_addr_candidates: [source],
      dash_addr: null,
      audio_addr: null,
      play_addr_h264: null,
      play_addr_lowbr: null,
      download_addr: null,
      cover: poster,
      dynamic_cover: poster,
      origin_cover: poster,
      width: 0,
      height: 0,
      duration: 0,
      duration_unit: "seconds",
      ratio: "",
    },
    statistics: {
      play_count: 0,
      digg_count: 0,
      comment_count: 0,
      share_count: 0,
      collect_count: 0,
      forward_count: 0,
    },
    media_urls: [{ type: "video", url: source }],
    image_urls: [],
    is_image: false,
    media_type: "video",
    music: null,
  };
}

function followingUserToUserInfo(user: FollowingUser): UserInfo {
  return {
    uid: user.uid || "",
    nickname: user.nickname || "抖音用户",
    avatar_thumb: user.avatar_thumb || "",
    avatar_medium: user.avatar_medium || user.avatar_thumb || "",
    avatar_larger: user.avatar_larger || user.avatar_medium || user.avatar_thumb || "",
    signature: user.signature || user.secondary_text || "",
    follower_count: Number(user.follower_count || 0),
    following_count: Number(user.following_count || 0),
    total_favorited: Number(user.total_favorited || 0),
    aweme_count: Number(user.aweme_count || 0),
    favoriting_count: Number(user.favoriting_count || 0),
    is_follow: true,
    follow_status: Number(user.follow_status || 1),
    sec_uid: user.sec_uid,
    unique_id: user.unique_id || "",
    short_id: user.short_id,
    verify_status: Number(user.verify_status || 0),
  };
}

function followingUserToFriend(user: FollowingUser): FriendStatusItem {
  return {
    secUid: user.sec_uid,
    uid: user.uid || "",
    nickname: user.nickname || "抖音用户",
    remarkName: "",
    avatar: user.avatar_thumb || user.avatar_medium || user.avatar_larger || "",
    signature: user.secondary_text || user.signature || user.unique_id || user.short_id || "",
    online: false,
    statusText: Number(user.follower_status || 0) > 0 ? "互关" : "已关注",
    lastActive: "未显示",
    lastActiveTime: 0,
  };
}

function mergeContactOverride(current: FriendStatusItem[], friend: FriendStatusItem) {
  const map = new Map(current.map((item) => [item.secUid, item]));
  map.set(friend.secUid, { ...map.get(friend.secUid), ...friend });
  return Array.from(map.values());
}

export function FriendsStatusView() {
  const setView = useAppStore((state) => state.setView);
  const openUser = useSearchStore((state) => state.openUser);
  const { downloadVideo } = useDownloads();
  const [input, setInput] = useState(readFriendStatusInput);
  const [currentSecUid, setCurrentSecUid] = useState<string>("");

  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [includeAllUsers, setIncludeAllUsers] = useState(false);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(DEFAULT_REFRESH_INTERVAL_SECONDS);
  const [currentUserAvatar, setCurrentUserAvatar] = useState(readCurrentUserAvatar);

  const [showManualInput, setShowManualInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [sharedPlayerVideos, setSharedPlayerVideos] = useState<VideoInfo[]>([]);
  const [sharedPlayerOpen, setSharedPlayerOpen] = useState(false);
  const [sharedPlayerLoadingId, setSharedPlayerLoadingId] = useState("");
  const [error, setError] = useState("");
  const [response, setResponse] = useState<any>(null);
  const [followingOpen, setFollowingOpen] = useState(false);
  const [contactOverrides, setContactOverrides] = useState<FriendStatusItem[]>([]);
  const [contactHasMore, setContactHasMore] = useState(false);
  const [contactNextOffset, setContactNextOffset] = useState(0);
  const [contactPageLoading, setContactPageLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);

  const idsRef = useRef<string[]>([]);
  const savedIdsRef = useRef<string[]>([]);
  const lastQueryIdsRef = useRef<string[]>([]);
  const lastQueryStartedAtRef = useRef(0);
  const queryInFlightRef = useRef(false);
  const lastBackgroundSignatureRef = useRef("");
  const contactPageLoadingRef = useRef(false);
  const contactHasMoreRef = useRef(false);
  const contactNextOffsetRef = useRef(0);
  const pendingBackgroundQueryRef = useRef(false);
  const pendingBackgroundTimerRef = useRef<number | null>(null);
  const cookieRetryTimerRef = useRef<number | null>(null);
  const avatarRetryTimerRef = useRef<number | null>(null);
  const initialInputRef = useRef(input);

  useEffect(() => {
    let active = true;
    getAccounts().then((res) => {
      if (active && res.success && res.current_sec_uid) {
        const uid = res.current_sec_uid;
        setCurrentSecUid(uid);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const ids = useMemo(() => extractIds(input), [input]);
  const friends = useMemo(() => {
    const map = new Map<string, FriendStatusItem>();
    if (response?.success) {
      mapResponse(response).forEach((friend) => {
        if (friend.secUid) map.set(friend.secUid, friend);
      });
    }
    contactOverrides.forEach((friend) => {
      if (friend.secUid) map.set(friend.secUid, { ...map.get(friend.secUid), ...friend });
    });
    return Array.from(map.values()).filter((friend) => !currentSecUid || friend.secUid !== currentSecUid);
  }, [contactOverrides, response, currentSecUid]);

  useEffect(() => {
    if (!currentSecUid || friends.length === 0) return;
    const uidNameMap: Record<string, string> = {};
    friends.forEach((friend) => {
      const uid = String(friend.uid || "").trim();
      const name = String(friend.remarkName || friend.nickname || "").trim();
      if (uid && name) uidNameMap[uid] = name;
    });
    writeFriendNameCache(currentSecUid, uidNameMap);
  }, [currentSecUid, friends]);

  const {
    chatDrafts,
    chatMessages,
    unreadCounts,
    chatSummaries,
    chatSessions,
    historyState,
    selectedFriendId,
    selectedFriend,
    selectedMessages,
    selectedHistory,
    imStatus,
    updateDraft,
    sendLocalMessage,
    sendLocalImageMessage,
    sendLocalVideoMessage,
    loadHistoryMessages,
    selectFriend,
    startNewChatSession,
    compressChatSession,
  } = useFriendsChat(friends, currentSecUid, setError);

  const friendItems = useMemo<FriendListItem[]>(() => friends
    .map((friend) => {
      const latestMessage = latestChatMessage(chatMessages[friend.secUid]);
      const persistedSummary = chatSummaries[friend.secUid];
      const displayMessage = latestMessage && latestMessage.createdAt >= (persistedSummary?.latestMessageAt || 0)
        ? latestMessage
        : persistedSummary?.latestMessage;
      const displayText = messagePreviewText(displayMessage || latestMessage);
      const previewText = latestMessage
        ? `${displayMessage?.direction === "out" ? "我：" : ""}${displayText || latestMessage.text}`
        : displayMessage
          ? `${displayMessage.direction === "out" ? "我：" : ""}${displayText}`
          : friend.signature || friend.secUid;
      return {
        ...friend,
        latestMessage: displayMessage,
        latestMessageAt: Math.max(
          latestMessage?.createdAt || 0,
          persistedSummary?.latestMessageAt || 0,
          friend.serverLatestMessageAt || 0,
        ),
        previewText,
        unreadCount: Math.max(unreadCounts[friend.secUid] || 0, persistedSummary?.unreadCount || 0),
      };
    })
    .sort((a, b) => {
      if (a.latestMessageAt || b.latestMessageAt) {
        return b.latestMessageAt - a.latestMessageAt;
      }
      return 0;
    }), [chatMessages, chatSummaries, friends, unreadCounts]);

  const onlineCount = friends.filter((friend) => friend.online).length;
  const offlineCount = friends.filter((friend) => !friend.online).length;
  const isInitialLoading = loading && friends.length === 0;

  const openFriendProfile = useCallback(
    async (friend: FriendStatusItem) => {
      const user: UserInfo = {
        uid: friend.uid,
        nickname: friend.remarkName || friend.nickname || "未知用户",
        avatar_thumb: friend.avatar,
        avatar_medium: friend.avatar,
        avatar_larger: friend.avatar,
        signature: friend.signature,
        follower_count: 0,
        following_count: 0,
        total_favorited: 0,
        aweme_count: 0,
        favoriting_count: 0,
        is_follow: false,
        follow_status: 0,
        sec_uid: friend.secUid,
        unique_id: "",
        verify_status: 0,
      };
      setView("user");
      await openUser(user, { loadVideos: true });
    },
    [openUser, setView],
  );

  const openFollowingProfile = useCallback(
    async (user: FollowingUser) => {
      setFollowingOpen(false);
      setView("user");
      await openUser(followingUserToUserInfo(user), { loadVideos: true });
    },
    [openUser, setView],
  );

  const startFollowingChat = useCallback((user: FollowingUser) => {
    const friend = followingUserToFriend(user);
    if (!friend.secUid) {
      setError("缺少关注用户 sec_uid，无法进入私信");
      return;
    }
    if (!friend.uid) {
      setError("缺少关注用户数字 uid，无法发送私信");
      return;
    }
    setContactOverrides((current) => mergeContactOverride(current, friend));
    setFollowingOpen(false);
    setError("");
    selectFriend(friend);
  }, [selectFriend]);

  const openSharedVideo = useCallback(async (card: SharedMessageCard) => {
    if (!card.itemId || sharedPlayerLoadingId) return;
    setSharedPlayerLoadingId(card.itemId);
    setError("");
    const workLabel = card.kind === "gallery" ? "图集" : "分享视频";
    try {
      const result = await getVideoDetail(card.itemId);
      if (!result.success || !result.video) {
        throw new Error(result.message || `无法加载${workLabel}`);
      }
      setSharedPlayerVideos([result.video]);
      setSharedPlayerOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `无法加载${workLabel}`);
    } finally {
      setSharedPlayerLoadingId("");
    }
  }, [sharedPlayerLoadingId]);

  const openSharedVideoAuthor = useCallback(
    async (video: VideoInfo) => {
      const user = videoAuthorToUserInfo(video);
      if (!user) {
        setError("作者信息不可用，无法打开主页");
        return;
      }
      setSharedPlayerOpen(false);
      setView("user");
      await openUser(user, { loadVideos: true });
    },
    [openUser, setView],
  );

  const openLocalVideo = useCallback((message: LocalChatMessage) => {
    if (message.status !== "sent") return;
    const video = buildLocalVideoPlayerItem(message);
    if (!video) {
      setError("本机视频预览已失效，请重新发送视频");
      return;
    }
    setError("");
    setSharedPlayerVideos([video]);
    setSharedPlayerOpen(true);
  }, []);

  const query = useCallback(async (overrideIds?: string[], options?: { background?: boolean; retryCookie?: boolean; append?: boolean; offset?: number }) => {
    const background = Boolean(options?.background);
    const append = Boolean(options?.append);
    if (background && Date.now() - lastQueryStartedAtRef.current < MIN_BACKGROUND_REFRESH_INTERVAL_MS) {
      return;
    }
    if (queryInFlightRef.current) {
      if (background) pendingBackgroundQueryRef.current = true;
      return;
    }
    const retryCookie = options?.retryCookie !== false;
    const baseIds = overrideIds ?? savedIdsRef.current;
    const queryIds = Array.from(new Set([...baseIds, ...idsRef.current]));
    const offset = append ? Math.max(0, Number(options?.offset ?? contactNextOffsetRef.current) || 0) : 0;
    queryInFlightRef.current = true;
    lastQueryStartedAtRef.current = Date.now();
    if (append) {
      setContactPageLoading(true);
    } else if (!background) {
      setError("");
      setLoading(true);
    } else {
      setBackgroundRefreshing(true);
    }
    try {
      writeFriendStatusInput(queryIds.join("\n"));
      const result = await getFriendOnlineStatus(queryIds, [], { offset, limit: CONTACT_PAGE_SIZE });
      const pageFriends = mapResponse(result);
      const hasUsableData = Boolean(
        result.success ||
        (Array.isArray(result.sec_user_ids) && result.sec_user_ids.length > 0) ||
        pageFriends.length > 0,
      );
      // 后台轮询时若数据与上次完全一致，跳过全部 setState，避免整列表无谓重渲染。
      const dataUnchanged =
        background && hasUsableData
          ? (() => {
              const signature = JSON.stringify({
                sec_user_ids: result.sec_user_ids,
                all_sec_user_ids: result.all_sec_user_ids,
                user_info: result.user_info,
                active_status: result.active_status,
              });
              if (signature === lastBackgroundSignatureRef.current) return true;
              lastBackgroundSignatureRef.current = signature;
              return false;
            })()
          : false;
      if (hasUsableData && !dataUnchanged) {
        setResponse((current: any) => mergeFriendStatusResponse(current, result, append));
        setContactHasMore(Boolean(result.has_more));
        setContactNextOffset(Number(result.next_offset || 0) || 0);
        lastQueryIdsRef.current = queryIds;
        setLastUpdatedAt(Date.now());
        setError("");
      }
      const allSecUserIds = Array.isArray(result.all_sec_user_ids)
        ? result.all_sec_user_ids
        : !append && Array.isArray(result.sec_user_ids)
          ? result.sec_user_ids
          : [];
      if (hasUsableData && !dataUnchanged && allSecUserIds.length > 0) {
        setSavedIds(allSecUserIds);
        setSavedCount(Number(result.total_count || allSecUserIds.length) || allSecUserIds.length);
        setInput(allSecUserIds.join("\n"));
        writeFriendStatusInput(allSecUserIds.join("\n"));
      }
      if (!hasUsableData && !background) {
        const message = result.message || "获取好友在线状态失败";
        if (retryCookie && COOKIE_REQUIRED_PATTERN.test(message)) {
          const config = await getConfig().catch(() => null);
          if (config?.cookie_set) {
            setError("");
            if (cookieRetryTimerRef.current !== null) {
              window.clearTimeout(cookieRetryTimerRef.current);
            }
            cookieRetryTimerRef.current = window.setTimeout(() => {
              cookieRetryTimerRef.current = null;
              void query(queryIds, { background, retryCookie: false });
            }, 700);
          } else {
            setError(message);
          }
        } else {
          setError(message);
        }
      }
    } catch (caught) {
      if (!background) {
        const message = caught instanceof Error ? caught.message : "获取好友在线状态失败";
        if (retryCookie && COOKIE_REQUIRED_PATTERN.test(message)) {
          const config = await getConfig().catch(() => null);
          if (config?.cookie_set) {
            setError("");
            if (cookieRetryTimerRef.current !== null) {
              window.clearTimeout(cookieRetryTimerRef.current);
            }
            cookieRetryTimerRef.current = window.setTimeout(() => {
              cookieRetryTimerRef.current = null;
              void query(queryIds, { background, retryCookie: false });
            }, 700);
          } else {
            setError(message);
          }
        } else {
          setError(message);
        }
      }
    } finally {
      queryInFlightRef.current = false;
      if (append) {
        setContactPageLoading(false);
      } else if (background) {
        setBackgroundRefreshing(false);
      } else {
        setLoading(false);
      }
      if (pendingBackgroundQueryRef.current) {
        pendingBackgroundQueryRef.current = false;
        if (pendingBackgroundTimerRef.current !== null) {
          window.clearTimeout(pendingBackgroundTimerRef.current);
        }
        pendingBackgroundTimerRef.current = window.setTimeout(() => {
          pendingBackgroundTimerRef.current = null;
          void query(undefined, { background: true });
        }, MIN_BACKGROUND_REFRESH_INTERVAL_MS);
      }
    }
  }, []);

  const loadMoreContacts = useCallback(() => {
    if (queryInFlightRef.current || contactPageLoadingRef.current || !contactHasMoreRef.current) return;
    void query(lastQueryIdsRef.current, { append: true, offset: contactNextOffsetRef.current });
  }, [query]);

  useEffect(() => {
    idsRef.current = ids;
  }, [ids]);

  useEffect(() => {
    savedIdsRef.current = savedIds;
  }, [savedIds]);

  useEffect(() => {
    contactPageLoadingRef.current = contactPageLoading;
  }, [contactPageLoading]);

  useEffect(() => {
    contactHasMoreRef.current = contactHasMore;
  }, [contactHasMore]);

  useEffect(() => {
    contactNextOffsetRef.current = contactNextOffset;
  }, [contactNextOffset]);

  useEffect(() => () => {
    if (cookieRetryTimerRef.current !== null) {
      window.clearTimeout(cookieRetryTimerRef.current);
    }
    if (avatarRetryTimerRef.current !== null) {
      window.clearTimeout(avatarRetryTimerRef.current);
    }
    if (pendingBackgroundTimerRef.current !== null) {
      window.clearTimeout(pendingBackgroundTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    void getConfig()
      .then((config) => {
        if (disposed) return;
        const savedIds = Array.isArray(config.im_friend_sec_user_ids)
          ? config.im_friend_sec_user_ids.filter(Boolean)
          : [];
        setSavedIds(savedIds);
        setSavedCount(savedIds.length);
        const nextInterval = Number(config.im_friend_refresh_interval_seconds) || DEFAULT_REFRESH_INTERVAL_SECONDS;
        setIncludeAllUsers(Boolean(config.im_friend_include_all_users));
        setRefreshIntervalSeconds(Math.max(0, nextInterval));
        if (!initialInputRef.current.trim() && savedIds.length > 0) {
          setInput(savedIds.join("\n"));
        }
        void query(savedIds);
      })
      .catch(() => {
        if (!disposed) void query([]);
      });
    return () => {
      disposed = true;
    };
  }, [query]);

  useEffect(() => {
    let disposed = false;
    let unlistenCookieLogin: (() => void) | null = null;
    const saveAvatar = (avatar: string) => {
      if (!avatar) return;
      setCurrentUserAvatar(avatar);
      writeCurrentUserAvatar(avatar);
    };
    const retry = (attempt: number) => {
      if (disposed || attempt >= 8) return;
      if (avatarRetryTimerRef.current !== null) {
        window.clearTimeout(avatarRetryTimerRef.current);
      }
      avatarRetryTimerRef.current = window.setTimeout(() => {
        avatarRetryTimerRef.current = null;
        void loadAvatar(attempt + 1);
      }, 700 + attempt * 700);
    };
    const loadAvatar = async (attempt = 0) => {
      try {
        const config = await getConfig().catch(() => null);
        if (disposed || !config?.cookie_set) return;
        const status = await verifyCookie();
        if (disposed) return;
        if (!status.valid) {
          retry(attempt);
          return;
        }
        const directAvatar = status.avatar_thumb || status.avatar_medium || status.avatar_larger || "";
        if (directAvatar) {
          saveAvatar(directAvatar);
          return;
        }
        const secUid = status.sec_uid || (status.user_id?.startsWith("MS4") ? status.user_id : "");
        if (!secUid) {
          retry(attempt);
          return;
        }
        const detail = await getUserDetail(secUid).catch(() => null);
        if (disposed || !detail?.success || !detail.user) return;
        const detailAvatar = detail.user.avatar_thumb || detail.user.avatar_medium || detail.user.avatar_larger || "";
        if (detailAvatar) {
          saveAvatar(detailAvatar);
        } else {
          retry(attempt);
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "";
        if (COOKIE_REQUIRED_PATTERN.test(message) || attempt < 8) retry(attempt);
      }
    };
    void loadAvatar();
    void listenEvent<CookieLoginStatusDetail>(COOKIE_LOGIN_STATUS_EVENT, (payload) => {
      if (payload?.cookie_set || payload?.event === "success") {
        void loadAvatar();
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenCookieLogin = unlisten;
    });
    return () => {
      disposed = true;
      unlistenCookieLogin?.();
      if (avatarRetryTimerRef.current !== null) {
        window.clearTimeout(avatarRetryTimerRef.current);
      }
    };
  }, []);

  const toggleIncludeAllUsers = async () => {
    const nextValue = !includeAllUsers;
    const previousValue = includeAllUsers;
    setIncludeAllUsers(nextValue);
    setError("");
    try {
      const result = await saveConfig({ im_friend_include_all_users: nextValue });
      if (!result.success) {
        throw new Error(result.message || "保存好友范围设置失败");
      }
      void query([], { background: friends.length > 0 });
    } catch (caught) {
      setIncludeAllUsers(previousValue);
      setError(caught instanceof Error ? caught.message : "保存好友范围设置失败");
    }
  };

  // 视图缓存后组件在切换走时仍保持挂载，隐藏期间暂停轮询；
  // 首次挂载由配置加载流程触发查询，重新切回时立即后台刷新一次。
  const viewActive = useAppStore((s) => s.currentView === "friends-status");
  const firstPollRunRef = useRef(true);

  useEffect(() => {
    if (refreshIntervalSeconds <= 0 || !viewActive) return;
    if (!firstPollRunRef.current) {
      void query(undefined, { background: true });
    }
    firstPollRunRef.current = false;
    const timer = window.setInterval(() => {
      void query(undefined, { background: true });
    }, Math.max(1, refreshIntervalSeconds) * 1000);
    return () => window.clearInterval(timer);
  }, [query, refreshIntervalSeconds, viewActive]);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1320px] flex-col gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-4 w-4 text-accent" />
          <h3 className="text-[0.95rem] font-semibold text-text">好友</h3>
          <span className="truncate text-[0.72rem] text-text-muted">
            {savedCount > 0 ? `已保存 ${savedCount}` : `${friends.length || ids.length} 个好友`}
            {backgroundRefreshing
              ? " · 正在更新"
              : lastUpdatedAt
                ? ` · 上次更新于 ${formatUpdateTime(lastUpdatedAt)}`
                : ""}
          </span>
          <span
            className={cn(
              "flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[0.68rem]",
              imStatus.connected
                ? "border-success/25 bg-success-soft text-success"
                : "border-border bg-surface-solid text-text-muted",
            )}
            title={imStatus.updatedAt ? `${imStatus.message} · ${formatUpdateTime(imStatus.updatedAt)}` : imStatus.message}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                imStatus.connected ? "bg-success" : "bg-text-muted",
              )}
            />
            {imStatus.connected ? "接收已连接" : "接收未连接"}
          </span>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowManualInput((value) => !value)}
            className="h-9"
          >
            备用 ID
            <Badge variant="secondary" size="sm">{ids.length}</Badge>
          </Button>
          {showManualInput && (
            <div className="absolute right-0 top-11 z-30 w-[min(420px,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-border bg-background p-3 shadow-[0_18px_42px_rgba(15,23,42,0.16)]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[0.76rem] font-semibold text-text-secondary">备用 ID 输入</span>
                <button
                  type="button"
                  onClick={() => setShowManualInput(false)}
                  className="text-[0.72rem] text-text-muted hover:text-text"
                >
                  收起
                </button>
              </div>
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="MS4w... 每行一个，或粘贴 curl 参数"
                className="min-h-[136px] resize-none bg-surface-solid"
                spellCheck={false}
              />
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFollowingOpen(true)}
            className="h-9"
          >
            <Users className="h-3.5 w-3.5" />
            我的关注
          </Button>
          <button
            type="button"
            role="switch"
            aria-checked={includeAllUsers}
            onClick={() => void toggleIncludeAllUsers()}
            disabled={loading}
            className={cn(
              "flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border px-3 text-[0.76rem] transition",
              includeAllUsers
                ? "border-accent/35 bg-accent-soft text-accent"
                : "border-border bg-surface-solid text-text-muted hover:text-text",
              loading && "cursor-not-allowed opacity-60",
            )}
          >
            <span
              className={cn(
                "relative h-4 w-7 rounded-full transition",
                includeAllUsers ? "bg-accent" : "bg-border-strong",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition",
                  includeAllUsers ? "left-3.5" : "left-0.5",
                )}
              />
            </span>
            {includeAllUsers ? "全部用户" : "仅互关"}
          </button>
          <Button size="sm" onClick={() => void query()} disabled={loading} className="h-9">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            刷新状态
          </Button>
        </div>
      </div>

      {error && (
        <InlineStatus tone="danger">
          {error}
        </InlineStatus>
      )}

      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
        <FriendListPanel
          friends={friends}
          friendItems={friendItems}
          selectedFriendId={selectedFriendId}
          onlineCount={onlineCount}
          offlineCount={offlineCount}
          isInitialLoading={isInitialLoading}
          isLoadingMore={contactPageLoading}
          hasMore={contactHasMore}
          idsLength={ids.length}
          selectFriend={selectFriend}
          openFriendProfile={openFriendProfile}
          onLoadMore={loadMoreContacts}
        />

        <ChatWorkspace
          friend={selectedFriend}
          draft={selectedFriend ? chatDrafts[selectedFriend.secUid] || "" : ""}
          messages={selectedMessages}
          session={selectedFriend ? chatSessions[selectedFriend.secUid] : undefined}
          historyError={selectedHistory?.error || ""}
          historyLoading={Boolean(selectedHistory?.loading)}
          canLoadOlder={Boolean(selectedFriend && selectedHistory?.nextCursor && selectedHistory.hasMore !== false)}
          currentUserAvatar={currentUserAvatar}
          onDraftChange={updateDraft}
          onSendMessage={sendLocalMessage}
          onSendImage={sendLocalImageMessage}
          onSendVideo={sendLocalVideoMessage}
          onStartNewSession={startNewChatSession}
          onCompressSession={compressChatSession}
          onLoadOlder={() => selectedFriend && selectedHistory?.nextCursor ? loadHistoryMessages(selectedFriend, selectedHistory.nextCursor) : Promise.resolve()}
          onOpenProfile={openFriendProfile}
          onOpenSharedVideo={openSharedVideo}
          onOpenLocalVideo={openLocalVideo}
          sharedPlayerLoadingId={sharedPlayerLoadingId}
        />
      </div>
      <FullscreenPlayer
        videos={sharedPlayerVideos}
        initialIndex={0}
        open={sharedPlayerOpen}
        onClose={() => setSharedPlayerOpen(false)}
        onDownload={sharedPlayerVideos[0]?.aweme_id ? (video) => downloadVideo(video) : undefined}
        onAuthor={(video) => void openSharedVideoAuthor(video)}
      />
      <FollowingListDialog
        open={followingOpen}
        onOpenChange={setFollowingOpen}
        onOpenProfile={openFollowingProfile}
        onStartChat={startFollowingChat}
      />
    </div>
  );
}
