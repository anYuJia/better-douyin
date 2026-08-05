import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { prewarmVideoForPlayback } from "@/lib/media-prewarm";
import { readBoolean, readString, writeBoolean, writeString } from "@/lib/storage";
import {
  getVideoDetail,
  mediaProxyUrl,
  setVideoCollected,
  setVideoLiked,
  type VideoInfo,
} from "@/lib/tauri";
import { usePlayerComments } from "./use-player-comments";
import { usePlayerShare } from "./use-player-share";
import { usePlayerBgm } from "./use-player-bgm";
import { usePlayerActionControls } from "./use-player-action-controls";
import { usePlayerSurfaceEvents } from "./use-player-surface-events";
import { usePlayerProgressLoop } from "./use-player-progress-loop";
import {
  collectVideoMedia,
  collectVideoQualityOptions,
  getMediaProxyType,
  getVideoBgmUrl,
  isVideoLikeMedia,
  shouldUseSeparateBgmForVideo,
  type VideoMediaItem,
} from "@/lib/video-media";
import { PlayerDescription } from "./player-description";
import { PlayerPlaybackBar } from "./player-playback-bar";
import { AuthorInfo } from "./player-info";
import { PlayerActionButtons } from "./player-actions";
import { TopCloseOverlay } from "./player-overlays";
import { PlayerMediaStage } from "./player-media-stage";
import {
  IMAGE_DURATION_SECONDS,
  LOAD_MORE_THRESHOLD,
  MAX_PRELOADED_MEDIA_NODES,
  PLAYER_MEDIA_ADVANCE_PRELOAD_TIMEOUT_MS,
  PLAYER_NEXT_VIDEO_PRELOAD_AHEAD_SECONDS,
  PLAYER_VIDEO_INITIAL_STATUS_DELAY_MS,
  PLAYER_VIDEO_LOAD_TIMEOUT_MS,
  PLAYER_VIDEO_MAX_AUTO_RETRIES,
  PLAYER_VIDEO_REBUFFER_STATUS_DELAY_MS,
  PLAYBACK_RATES,
  SESSION_CACHE_BUSTER,
  applyPlaybackRateToNode,
  finiteMediaTime,
  getDocumentVideoNode,
  isKeyboardInputTarget,
  mediaMotionVariants,
  playerMediaProxyUrl,
  releaseMediaElement,
  releaseScopedMediaElements,
  resolveMediaDirection,
  type PlayerPanel,
} from "./player-utils";

const AUTO_PLAY_NEXT_VIDEO_STORAGE_KEY = "player_auto_play_next_video";
const PLAYER_VOLUME_STORAGE_KEY = "player_volume";
const PLAYER_MUTED_STORAGE_KEY = "player_muted";
const PLAYER_PLAYBACK_RATE_STORAGE_KEY = "player_playback_rate";
const IMAGE_PROGRESS_INTERVAL_MS = 50;

function clampPlayerVolume(value: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readStoredPlayerVolume(): number {
  const rawValue = readString(PLAYER_VOLUME_STORAGE_KEY, "");
  if (rawValue.trim() === "") return 100;
  const value = Number(rawValue);
  return Number.isFinite(value) ? clampPlayerVolume(value) : 100;
}

function readStoredPlayerMuted(): boolean {
  return readBoolean(PLAYER_MUTED_STORAGE_KEY, false);
}

function normalizeStoredPlaybackRate(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return PLAYBACK_RATES.find((rate) => Math.abs(rate - value) < 0.001) ?? 1;
}

function readStoredPlayerPlaybackRate(): number {
  return normalizeStoredPlaybackRate(Number(readString(PLAYER_PLAYBACK_RATE_STORAGE_KEY, "")));
}

function readStoredAutoPlayNextVideo(): boolean {
  return readBoolean(AUTO_PLAY_NEXT_VIDEO_STORAGE_KEY, false);
}

function buildAudioDownloadVideo(video: VideoInfo, audioUrl: string): VideoInfo {
  const title = video.music?.title || video.desc || video.aweme_id;
  return {
    ...video,
    desc: title ? `${title} 音频` : "背景音乐",
    media_type: "audio",
    raw_media_type: "audio",
    media_urls: [{ type: "audio", url: audioUrl }],
    video: {
      ...video.video,
      audio_addr: audioUrl,
      play_addr: "",
      play_addr_h264: null,
      play_addr_lowbr: null,
      download_addr: null,
    },
  };
}

export interface FullscreenPlayerProps {
  videos: VideoInfo[];
  initialIndex?: number;
  initialMediaIndex?: number;
  open: boolean;
  onClose: () => void;
  onDownload?: (video: VideoInfo) => void | Promise<void>;
  onLoadMore?: () => void;
  onShowDetail?: (video: VideoInfo) => void;
  onAuthor?: (video: VideoInfo) => void;
  onVideoUpdate?: (video: VideoInfo) => void;
  openComments?: boolean;
  initialComment?: {
    cid: string;
    root_cid?: string;
    is_sub?: boolean;
    text: string;
    digg_count: number;
    create_time: number;
    user: { uid: string; nickname: string; sec_uid: string; avatar: string };
    reply_to_user?: { uid: string; nickname: string; sec_uid: string; avatar: string } | null;
    reply_to_text?: string;
  } | null;
}

export function FullscreenPlayer({
  videos,
  initialIndex = 0,
  initialMediaIndex = 0,
  open,
  onClose,
  onDownload,
  onLoadMore,
  onShowDetail,
  onAuthor,
  onVideoUpdate,
  openComments = false,
  initialComment = null,
}: FullscreenPlayerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [mediaTransition, setMediaTransition] = useState({ index: 0, direction: 0 });
  const [playing, setPlaying] = useState(false);
  const [liked, setLiked] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [relationHydrating, setRelationHydrating] = useState(false);
  const [relationSubmitting, setRelationSubmitting] = useState<"like" | "collect" | null>(null);
  const [volume, setVolume] = useState(readStoredPlayerVolume);
  const [muted, setMuted] = useState(readStoredPlayerMuted);
  const [playbackRate, setPlaybackRate] = useState(readStoredPlayerPlaybackRate);
  const [selectedQualityKey, setSelectedQualityKey] = useState("auto");
  const [openPanel, setOpenPanel] = useState<PlayerPanel | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [showLoadStatus, setShowLoadStatus] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [downloadSubmitting, setDownloadSubmitting] = useState(false);
  const [bgmDownloadSubmitting, setBgmDownloadSubmitting] = useState(false);
  const [autoPlayNextVideo, setAutoPlayNextVideo] = useState(readStoredAutoPlayNextVideo);

  const [videoOverrides, setVideoOverrides] = useState<Record<string, VideoInfo>>({});
  const [navigationNotice, setNavigationNotice] = useState("");
  const playerRootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceHitRef = useRef<HTMLDivElement>(null);
  const bgmRef = useRef<HTMLAudioElement>(null);
  const loadMoreRequestedForLength = useRef(0);
  const imageAdvanceQueued = useRef(false);
  const desiredPlayingRef = useRef(true);
  const playingRef = useRef(false);
  const playbackRateRef = useRef(playbackRate);
  const mediaSwitchingRef = useRef(false);
  const mediaAdvanceSeqRef = useRef(0);
  const qualitySwitchingRef = useRef(false);
  const mediaSwitchReleaseRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const qualitySwitchReleaseRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const panelCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const loadStatusTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const loadTimeoutTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const bufferingTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const navigationNoticeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const autoRetryCountRef = useRef(0);
  const refreshingDetailRef = useRef(false);
  const relationRefreshSeqRef = useRef(0);
  const relationRefreshedIdsRef = useRef(new Set<string>());
  const refreshedDetailIdsRef = useRef(new Set<string>());
  const pendingQualitySeekRef = useRef<number | null>(null);
  const preloadedMediaRef = useRef(new Map<string, boolean>());
  const preloadedReadyRef = useRef(new Set<string>());
  const preloadedNodesRef = useRef<Array<HTMLImageElement | HTMLVideoElement>>([]);
  const wasOpenRef = useRef(open);

  const safeInitialIndexForOpen = Math.min(Math.max(initialIndex, 0), Math.max(videos.length - 1, 0));
  const isOpeningRender = open && !wasOpenRef.current;
  const activeCurrentIndex = isOpeningRender ? safeInitialIndexForOpen : currentIndex;
  const rawCurrentVideo = videos[activeCurrentIndex] || null;
  const currentVideo = rawCurrentVideo?.aweme_id
    ? videoOverrides[rawCurrentVideo.aweme_id] || rawCurrentVideo
    : rawCurrentVideo;
  const mediaItems = useMemo(
    () => (currentVideo ? collectVideoMedia(currentVideo) : []),
    [currentVideo]
  );
  const safeInitialMediaIndexForOpen = Math.min(
    Math.max(initialMediaIndex, 0),
    Math.max(mediaItems.length - 1, 0)
  );
  const mediaIndex = mediaTransition.index;
  const mediaTransitionDirection = mediaTransition.direction;
  const activeMediaIndex = isOpeningRender ? safeInitialMediaIndexForOpen : mediaIndex;
  const currentMedia = mediaItems[activeMediaIndex] || mediaItems[0] || null;
  const isLocalMedia = !currentVideo?.aweme_id || /^(?:blob|data):/i.test(currentMedia?.url || "");
  const showWorkActions = !isLocalMedia;
  const qualityOptions = useMemo(
    () => currentMedia?.type === "video" ? collectVideoQualityOptions(currentVideo, currentMedia.url) : [],
    [currentMedia?.type, currentMedia?.url, currentVideo]
  );
  const selectedQualityOption = qualityOptions.find((option) => option.key === selectedQualityKey);
  const activeQualityOption =
    selectedQualityKey === "auto" || selectedQualityOption?.isAuto
      ? null
      : selectedQualityOption || null;
  const displayQualityOption = selectedQualityOption || qualityOptions[0] || null;
  const currentPlaybackUrl =
    currentMedia && currentMedia.type === "video" && activeQualityOption
      ? activeQualityOption.url
      : currentMedia?.url || "";
  const currentMediaSrc = currentMedia
    ? playerMediaProxyUrl(currentPlaybackUrl, getMediaProxyType(currentMedia), reloadKey)
    : "";
  const mediaKey = currentMedia
    ? `${currentVideo?.aweme_id || "video"}-${activeMediaIndex}-${currentMedia.type}-${currentMedia.url}-${reloadKey}`
    : "empty";
  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const hasMultipleMedia = mediaItems.length > 1;
  const initialVideoKey = videos[initialIndex]?.aweme_id || "";
  const authorAvatar =
    currentVideo?.author?.avatar_thumb || currentVideo?.author?.avatar_medium || "";
  const authorName =
    currentVideo?.author?.nickname || currentVideo?.author?.unique_id || "用户";
  const canOpenAuthor = Boolean(onAuthor && currentVideo?.author?.sec_uid);
  const likeBaseCount = currentVideo?.statistics?.digg_count || 0;
  const favoriteBaseCount = currentVideo?.statistics?.collect_count || 0;
  const likeCount = Math.max(
    0,
    likeBaseCount + (liked && !currentVideo?.is_liked ? 1 : !liked && currentVideo?.is_liked ? -1 : 0)
  );
  const favoriteCount =
    Math.max(
      0,
      favoriteBaseCount +
        (favorited && !currentVideo?.is_collected ? 1 : !favorited && currentVideo?.is_collected ? -1 : 0)
    );
  const workMusicUrl = getVideoBgmUrl(currentVideo);
  const mediaMusicUrl = getVideoBgmUrl(currentVideo, currentMedia);
  const musicUrl = hasMultipleMedia ? workMusicUrl || mediaMusicUrl : mediaMusicUrl;
  const bgmProxyUrl = musicUrl ? mediaProxyUrl(musicUrl, "audio") : "";
  const effectiveVolume = muted ? 0 : volume;
  const shouldUseBgmForCurrentMedia = Boolean(
    currentMedia &&
      musicUrl &&
      (shouldUseSeparateBgmForVideo(currentMedia, currentVideo) || hasMultipleMedia)
  );
  const shouldAutoPlayCurrentMedia = open && (desiredPlayingRef.current || isOpeningRender);
  const showQualityControl = currentMedia?.type === "video";

  useEffect(() => {
    writeString(PLAYER_VOLUME_STORAGE_KEY, String(clampPlayerVolume(volume)));
  }, [volume]);

  useEffect(() => {
    writeBoolean(PLAYER_MUTED_STORAGE_KEY, muted);
  }, [muted]);

  useEffect(() => {
    writeString(PLAYER_PLAYBACK_RATE_STORAGE_KEY, String(normalizeStoredPlaybackRate(playbackRate)));
  }, [playbackRate]);

  useEffect(() => {
    setLiked(Boolean(currentVideo?.is_liked));
    setFavorited(Boolean(currentVideo?.is_collected));
    setRelationSubmitting(null);
  }, [currentVideo?.aweme_id, currentVideo?.is_liked, currentVideo?.is_collected]);

  const {
    stopVideoProgressLoop,
    syncVideoProgress,
    startVideoProgressLoop,
    progressSampleRef,
  } = usePlayerProgressLoop({
    videoRef,
    setCurrentTime,
    setDuration,
  });

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const clearLoadTimers = useCallback(() => {
    if (loadStatusTimerRef.current) {
      window.clearTimeout(loadStatusTimerRef.current);
      loadStatusTimerRef.current = null;
    }
    if (loadTimeoutTimerRef.current) {
      window.clearTimeout(loadTimeoutTimerRef.current);
      loadTimeoutTimerRef.current = null;
    }
    if (bufferingTimerRef.current) {
      window.clearTimeout(bufferingTimerRef.current);
      bufferingTimerRef.current = null;
    }
  }, []);

  const setVideoElementRef = useCallback((node: HTMLVideoElement | null) => {
    if (!node) return;
    videoRef.current = node;
  }, []);

  const goToVideo = useCallback((index: number) => {
    if (index < 0 || index >= videos.length) return;
    mediaAdvanceSeqRef.current += 1;
    desiredPlayingRef.current = true;
    mediaSwitchingRef.current = false;
    clearLoadTimers();
    stopVideoProgressLoop();
    releaseMediaElement(videoRef.current);
    setCurrentIndex(index);
    setMediaTransition({ index: 0, direction: 0 });
    setCurrentTime(0);
    setDuration(0);
    progressSampleRef.current = 0;
    setPlaying(false);
    setReloadKey((value) => value + 1);
  }, [clearLoadTimers, stopVideoProgressLoop, videos.length]);

  const showNavigationNotice = useCallback((message: string) => {
    setNavigationNotice(message);
    if (navigationNoticeTimerRef.current) {
      window.clearTimeout(navigationNoticeTimerRef.current);
    }
    navigationNoticeTimerRef.current = window.setTimeout(() => {
      setNavigationNotice("");
      navigationNoticeTimerRef.current = null;
    }, 1400);
  }, []);

  const patchCurrentVideoRelation = useCallback((awemeId: string, patch: Partial<VideoInfo>) => {
    setVideoOverrides((current) => {
      const base = current[awemeId] || videos.find((video) => video.aweme_id === awemeId);
      if (!base) return current;
      const nextVideo = {
        ...base,
        ...patch,
        statistics: patch.statistics
          ? {
              ...base.statistics,
              ...patch.statistics,
            }
          : base.statistics,
      };
      onVideoUpdate?.(nextVideo);
      return {
        ...current,
        [awemeId]: nextVideo,
      };
    });
  }, [onVideoUpdate, videos]);

  const refreshCurrentRelationState = useCallback(async (awemeId: string) => {
    if (!awemeId) return;
    const requestSeq = relationRefreshSeqRef.current + 1;
    relationRefreshSeqRef.current = requestSeq;
    setRelationHydrating(true);

    try {
      const result = await getVideoDetail(awemeId);
      if (relationRefreshSeqRef.current !== requestSeq || !result.success || !result.video) {
        return;
      }

      const detail = result.video;
      const nextLiked = Boolean(detail.is_liked);
      const nextCollected = Boolean(detail.is_collected);
      setLiked(nextLiked);
      setFavorited(nextCollected);
      patchCurrentVideoRelation(awemeId, {
        is_liked: nextLiked,
        is_collected: nextCollected,
        statistics: detail.statistics,
      });
    } catch {
      // Keep the list-provided relation state if the detail refresh is blocked.
    } finally {
      if (relationRefreshSeqRef.current === requestSeq) {
        setRelationHydrating(false);
      }
    }
  }, [patchCurrentVideoRelation]);

  useEffect(() => {
    if (!open || loadState !== "ready" || !currentVideo?.aweme_id) return;
    if (relationRefreshedIdsRef.current.has(currentVideo.aweme_id)) return;
    relationRefreshedIdsRef.current.add(currentVideo.aweme_id);
    const timer = window.setTimeout(() => {
      void refreshCurrentRelationState(currentVideo.aweme_id);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [currentVideo?.aweme_id, loadState, open, refreshCurrentRelationState]);

  const toggleLike = useCallback(async () => {
    const awemeId = currentVideo?.aweme_id;
    if (!awemeId || relationSubmitting) return false;

    const previousLiked = liked;
    const nextLiked = !previousLiked;
    const nextCount = Math.max(0, likeBaseCount + (nextLiked ? 1 : -1));
    relationRefreshSeqRef.current += 1;
    setRelationSubmitting("like");
    setLiked(nextLiked);
    patchCurrentVideoRelation(awemeId, {
      is_liked: nextLiked,
      statistics: { ...currentVideo.statistics, digg_count: nextCount },
    });

    try {
      const result = await setVideoLiked(awemeId, nextLiked);
      if (!result.success) throw new Error(result.message || "点赞失败");
      const actualLiked = result.is_liked ?? nextLiked;
      const actualCount = Math.max(0, likeBaseCount + (actualLiked && !previousLiked ? 1 : !actualLiked && previousLiked ? -1 : 0));
      setLiked(actualLiked);
      patchCurrentVideoRelation(awemeId, {
        is_liked: actualLiked,
        statistics: { ...currentVideo.statistics, digg_count: actualCount },
      });
      if (actualLiked !== nextLiked) {
        throw new Error(result.message || "点赞状态未生效");
      }
      showNavigationNotice(actualLiked ? "已点赞" : "已取消点赞");
      return true;
    } catch (error) {
      setLiked(previousLiked);
      patchCurrentVideoRelation(awemeId, {
        is_liked: previousLiked,
        statistics: currentVideo.statistics,
      });
      showNavigationNotice(error instanceof Error ? error.message : "点赞失败");
      return false;
    } finally {
      setRelationSubmitting(null);
    }
  }, [currentVideo, likeBaseCount, liked, patchCurrentVideoRelation, relationSubmitting, showNavigationNotice]);

  const toggleCollect = useCallback(async () => {
    const awemeId = currentVideo?.aweme_id;
    if (!awemeId || relationSubmitting) return false;

    const previousCollected = favorited;
    const nextCollected = !previousCollected;
    const nextCount = Math.max(0, favoriteBaseCount + (nextCollected ? 1 : -1));
    relationRefreshSeqRef.current += 1;
    setRelationSubmitting("collect");
    setFavorited(nextCollected);
    patchCurrentVideoRelation(awemeId, {
      is_collected: nextCollected,
      statistics: { ...currentVideo.statistics, collect_count: nextCount },
    });

    try {
      const result = await setVideoCollected(awemeId, nextCollected);
      if (!result.success) throw new Error(result.message || "收藏失败");
      showNavigationNotice(nextCollected ? "已收藏" : "已取消收藏");
      return true;
    } catch (error) {
      setFavorited(previousCollected);
      patchCurrentVideoRelation(awemeId, {
        is_collected: previousCollected,
        statistics: currentVideo.statistics,
      });
      showNavigationNotice(error instanceof Error ? error.message : "收藏失败");
      return false;
    } finally {
      setRelationSubmitting(null);
    }
  }, [currentVideo, favoriteBaseCount, favorited, patchCurrentVideoRelation, relationSubmitting, showNavigationNotice]);

  const playNextVideo = useCallback(() => {
    if (currentIndex < videos.length - 1) {
      goToVideo(currentIndex + 1);
      return;
    }
    if (onLoadMore) {
      showNavigationNotice("正在加载更多视频...");
      onLoadMore();
      return;
    }
    showNavigationNotice("已经是最后一个视频");
  }, [currentIndex, goToVideo, onLoadMore, showNavigationNotice, videos.length]);

  const playPrevVideo = useCallback(() => {
    if (currentIndex > 0) {
      goToVideo(currentIndex - 1);
      return;
    }
    showNavigationNotice("已经是第一个视频");
  }, [currentIndex, goToVideo, showNavigationNotice]);

  const rememberPreloadedNode = useCallback((node: HTMLImageElement | HTMLVideoElement) => {
    preloadedNodesRef.current.push(node);
    while (preloadedNodesRef.current.length > MAX_PRELOADED_MEDIA_NODES) {
      const removed = preloadedNodesRef.current.shift();
      if (removed instanceof HTMLVideoElement) {
        releaseMediaElement(removed);
      } else if (removed) {
        removed.removeAttribute("src");
      }
    }
  }, []);

  const resolvePreloadTarget = useCallback((media: VideoMediaItem | null | undefined) => {
    if (!media) return null;
    const mediaType = getMediaProxyType(media);
    const proxiedUrl = playerMediaProxyUrl(media.url, mediaType, reloadKey);
    if (!proxiedUrl) return null;
    return {
      key: `${media.type}::${proxiedUrl}`,
      url: proxiedUrl,
    };
  }, [reloadKey]);

  const waitForMediaReady = useCallback((media: VideoMediaItem | null | undefined) => {
    const target = resolvePreloadTarget(media);
    if (!target || !media) return Promise.resolve();
    if (preloadedReadyRef.current.has(target.key)) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof window.setTimeout>;

      if (media.type === "image") {
        const image = new Image();
        image.decoding = "async";
        image.loading = "eager";

        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          image.onload = null;
          image.onerror = null;
          if (image.naturalWidth > 0) {
            preloadedReadyRef.current.add(target.key);
          }
          rememberPreloadedNode(image);
          resolve();
        };

        image.onload = () => {
          if (typeof image.decode === "function") {
            void image.decode().catch(() => undefined).finally(finish);
            return;
          }
          finish();
        };
        image.onerror = finish;
        timer = window.setTimeout(finish, PLAYER_MEDIA_ADVANCE_PRELOAD_TIMEOUT_MS);
        image.src = target.url;
        if (image.complete && image.naturalWidth > 0) finish();
        return;
      }

      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;

      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        video.removeEventListener("loadeddata", finish);
        video.removeEventListener("canplay", finish);
        video.removeEventListener("error", finish);
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          preloadedReadyRef.current.add(target.key);
        }
        rememberPreloadedNode(video);
        resolve();
      };

      video.addEventListener("loadeddata", finish);
      video.addEventListener("canplay", finish);
      video.addEventListener("error", finish);
      timer = window.setTimeout(finish, PLAYER_MEDIA_ADVANCE_PRELOAD_TIMEOUT_MS);
      video.src = target.url;
      video.load();
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish();
    });
  }, [rememberPreloadedNode, resolvePreloadTarget]);

  const releaseMediaSwitchSoon = useCallback(() => {
    if (mediaSwitchReleaseRef.current) {
      window.clearTimeout(mediaSwitchReleaseRef.current);
    }
    mediaSwitchReleaseRef.current = window.setTimeout(() => {
      mediaSwitchingRef.current = false;
      mediaSwitchReleaseRef.current = null;
    }, 650);
  }, []);

  const switchToMedia = useCallback((index: number, explicitDirection?: number) => {
    if (mediaItems.length === 0) return;
    mediaAdvanceSeqRef.current += 1;
    const safeIndex = ((index % mediaItems.length) + mediaItems.length) % mediaItems.length;
    const direction = explicitDirection ?? resolveMediaDirection(mediaIndex, index, mediaItems.length);
    const shouldKeepPlaying = desiredPlayingRef.current || playing;
    desiredPlayingRef.current = shouldKeepPlaying;
    mediaSwitchingRef.current = true;
    if (mediaSwitchReleaseRef.current) {
      window.clearTimeout(mediaSwitchReleaseRef.current);
    }
    setMediaTransition({ index: safeIndex, direction });
    setCurrentTime(0);
    setDuration(0);
    progressSampleRef.current = 0;
    setPlaying(shouldKeepPlaying);
  }, [mediaIndex, mediaItems.length, playing]);

  const playNextMedia = useCallback(() => {
    if (mediaItems.length > 1) {
      switchToMedia(mediaIndex + 1, 1);
      return;
    }
    playNextVideo();
  }, [mediaIndex, mediaItems.length, playNextVideo, switchToMedia]);

  const playPrevMedia = useCallback(() => {
    if (mediaItems.length > 1) {
      switchToMedia(mediaIndex - 1, -1);
      return;
    }
    playPrevVideo();
  }, [mediaIndex, mediaItems.length, playPrevVideo, switchToMedia]);

  const advanceMediaSequence = useCallback(() => {
    if (mediaItems.length === 0) return;
    desiredPlayingRef.current = true;
    if (mediaItems.length > 1) {
      const hasNextMedia = mediaIndex < mediaItems.length - 1;
      if (!hasNextMedia && autoPlayNextVideo && videos.length > 1) {
        playNextVideo();
        return;
      }
      const nextIndex = hasNextMedia ? mediaIndex + 1 : 0;
      const nextMedia = mediaItems[nextIndex];
      const nextTarget = resolvePreloadTarget(nextMedia);
      if (nextTarget && preloadedReadyRef.current.has(nextTarget.key)) {
        switchToMedia(nextIndex, 1);
        return;
      }
      const requestSeq = ++mediaAdvanceSeqRef.current;
      mediaSwitchingRef.current = true;
      setPlaying(true);
      void waitForMediaReady(nextMedia).then(() => {
        if (requestSeq !== mediaAdvanceSeqRef.current) return;
        switchToMedia(nextIndex, 1);
      });
      return;
    }
    if (autoPlayNextVideo && videos.length > 1) {
      playNextVideo();
      return;
    }
    imageAdvanceQueued.current = false;
    setCurrentTime(0);
    setDuration(IMAGE_DURATION_SECONDS);
    setPlaying(true);
    setReloadKey((value) => value + 1);
  }, [autoPlayNextVideo, mediaIndex, mediaItems, playNextVideo, resolvePreloadTarget, switchToMedia, videos.length, waitForMediaReady]);

  const toggleAutoPlayNextVideo = useCallback(() => {
    setAutoPlayNextVideo((current) => {
      const next = !current;
      writeBoolean(AUTO_PLAY_NEXT_VIDEO_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const requestAdvanceMediaSequence = useCallback(() => {
    window.requestAnimationFrame(() => {
      advanceMediaSequence();
    });
  }, [advanceMediaSequence]);

  const togglePlay = useCallback(() => {
    if (!currentMedia) return;
    if (!isVideoLikeMedia(currentMedia)) {
      setPlaying((value) => {
        const nextPlaying = !value;
        if (!nextPlaying) {
          mediaAdvanceSeqRef.current += 1;
        }
        desiredPlayingRef.current = nextPlaying;
        return nextPlaying;
      });
      return;
    }

    const node = videoRef.current || getDocumentVideoNode(surfaceHitRef.current);
    if (!node) return;
    if (node.paused) {
      desiredPlayingRef.current = true;
      void node.play().then(() => {
        setPlaying(true);
        startVideoProgressLoop();
      }).catch(() => setPlaying(false));
    } else {
      mediaAdvanceSeqRef.current += 1;
      desiredPlayingRef.current = false;
      node.pause();
      setPlaying(false);
    }
  }, [currentMedia, startVideoProgressLoop]);

  const {
    handleSurfacePointerDown,
    handleSurfacePointerUp,
    handleSurfacePointerCancel,
    handleSurfaceMouseDown,
    handleSurfaceMouseUp,
    handleSurfaceTouchStart,
    handleSurfaceTouchEnd,
    handleSurfaceClick,
    handleWheel,
    handleTouchStart,
    handleTouchEnd,
  } = usePlayerSurfaceEvents({
    open,
    surfaceHitRef,
    playerRootRef,
    videoRef,
    playingRef,
    setPlaying,
    startVideoProgressLoop,
    togglePlay,
    desiredPlayingRef,
    mediaAdvanceSeqRef,
    playNextMedia,
    playPrevMedia,
    playNextVideo,
    playPrevVideo,
  });

  const {
    clearPanelCloseTimer,
    openToolPanel,
    schedulePanelClose,
    openPanelOnPointerEnter,
    closePanelOnPointerLeave,
    togglePanel,
    openPanelOnPointerDown,
    copyCurrentMediaUrl,
    handleDownloadCurrent,
    toggleMute,
    handleVolumeChange,
    syncPlaybackRate,
    handlePlaybackRateChange,
    handleQualityChange,
    restorePendingQualitySeek,
    resumeVideoIfDesired,
  } = usePlayerActionControls({
    openPanel,
    setOpenPanel,
    volume,
    setVolume,
    muted,
    setMuted,
    playbackRate,
    setPlaybackRate,
    currentPlaybackUrl,
    currentMedia,
    currentVideo,
    onDownload,
    downloadSubmitting,
    setDownloadSubmitting,
    reloadKey,
    currentTime,
    setCurrentTime,
    setPlaying,
    setLoadState,
    setShowLoadStatus,
    setDuration,
    effectiveVolume,
    shouldUseBgmForCurrentMedia,
    selectedQualityKey,
    setSelectedQualityKey,
    qualityOptions,
    videoRef,
    bgmRef,
    playerRootRef,
    playbackRateRef,
    playingRef,
    desiredPlayingRef,
    mediaSwitchingRef,
    qualitySwitchingRef,
    qualitySwitchReleaseRef,
    pendingQualitySeekRef,
    panelCloseTimerRef,
    startVideoProgressLoop,
  });

  const handleDownloadBgm = useCallback(async (event: ReactMouseEvent) => {
    event.stopPropagation();
    clearPanelCloseTimer();
    setOpenPanel(null);
    if (!musicUrl || !currentVideo || !onDownload || bgmDownloadSubmitting) return;

    setBgmDownloadSubmitting(true);
    try {
      await Promise.resolve(onDownload(buildAudioDownloadVideo(currentVideo, musicUrl)));
    } catch {
      console.warn("BGM download failed");
    } finally {
      setBgmDownloadSubmitting(false);
    }
  }, [bgmDownloadSubmitting, clearPanelCloseTimer, currentVideo, musicUrl, onDownload, setOpenPanel]);

  const {
    bgmPlaying,
    bgmDesiredPlayingRef,
    bgmManuallyPausedRef,
    playBgm,
    pauseBgm,
    releaseBgm,
    toggleBgm,
  } = usePlayerBgm({
    open,
    currentVideo,
    currentMedia,
    musicUrl,
    bgmProxyUrl,
    shouldUseBgmForCurrentMedia,
    effectiveVolume,
    muted,
    volume,
    playbackRateRef,
    loadState,
    mediaSwitchingRef,
    desiredPlayingRef,
    bgmRef,
  });

  const {
    shareFriends,
    shareFriendsLoading,
    shareFriendsError,
    shareSendingFriendKey,
    shareSentFriendKeys,
    handleShareFriendClick,
  } = usePlayerShare({
    currentVideo,
    openPanel,
    showNavigationNotice,
  });

  const {
    commentsOpen,
    comments,
    commentsLoading,
    commentsError,
    commentsHasMore,
    commentsTotal,
    commentReplies,
    expandedCommentReplyIds,
    commentDiggingIds,
    commentDraft,
    commentSubmitting,
    commentAiSuggesting,
    commentAiSuggestions,
    commentAiHint,
    commentReplyTarget,
    highlightCid,
    locatePrompt,
    registerCommentRef,
    registerReplyRef,
    setLocatePrompt,
    setCommentDraft,
    setCommentReplyTarget,
    loadCommentReplies,
    toggleCommentReplies,
    toggleCommentLike,
    submitComment,
    suggestCommentDraft,
    applyCommentAiSuggestion,
    handleCommentsScroll,
    openCommentsPanel,
    markCommentsPanelSticky,
    scheduleTransientCommentsClose,
    closeCommentsPanel,
    loadComments,
  } = usePlayerComments({
    open,
    openPanel,
    currentVideo,
    showNavigationNotice,
    clearPanelCloseTimer,
    setOpenPanel,
    onAutoLikeVideo: toggleLike,
    onAutoCollectVideo: toggleCollect,
    isVideoLiked: liked,
    isVideoCollected: favorited,
    openComments,
    initialComment,
  });





  const handleSeek = useCallback((nextTime: number) => {
    if (!duration) return;
    const safeTime = Math.max(0, Math.min(duration, nextTime));
    setCurrentTime(safeTime);
    progressSampleRef.current = performance.now();

    const node = videoRef.current || getDocumentVideoNode(playerRootRef.current);
    if (currentMedia && isVideoLikeMedia(currentMedia) && node) {
      try {
        if (typeof node.fastSeek === "function") {
          node.fastSeek(safeTime);
        } else {
          node.currentTime = safeTime;
        }
      } catch {
        try {
          node.currentTime = safeTime;
        } catch {
          return;
        }
      }

      window.requestAnimationFrame(() => {
        if (videoRef.current !== node) return;
        const actualTime = finiteMediaTime(node.currentTime);
        setCurrentTime(actualTime || safeTime);
      });
    }
  }, [currentMedia, duration]);

  const refreshCurrentVideoDetail = useCallback(async () => {
    const awemeId = currentVideo?.aweme_id;
    if (!awemeId || refreshingDetailRef.current || refreshedDetailIdsRef.current.has(awemeId)) {
      return false;
    }

    refreshingDetailRef.current = true;
    refreshedDetailIdsRef.current.add(awemeId);
    setLoadState("loading");
    setShowLoadStatus(true);

    try {
      const result = await getVideoDetail(awemeId);
      if (!result.success || !result.video) {
        return false;
      }

      setVideoOverrides((current) => ({
        ...current,
        [awemeId]: result.video as VideoInfo,
      }));
      setMediaTransition({ index: 0, direction: 0 });
      setCurrentTime(0);
      setDuration(0);
      setReloadKey((value) => value + 1);
      return true;
    } catch {
      return false;
    } finally {
      refreshingDetailRef.current = false;
    }
  }, [currentVideo?.aweme_id]);

  const retryCurrentMedia = useCallback((event?: ReactMouseEvent, auto = false) => {
    event?.stopPropagation();
    if (!auto && currentVideo?.aweme_id) {
      refreshedDetailIdsRef.current.delete(currentVideo.aweme_id);
    }
    clearLoadTimers();
    autoRetryCountRef.current = auto ? autoRetryCountRef.current : 0;
    setLoadState("loading");
    setShowLoadStatus(true);
    setCurrentTime(0);
    setDuration(0);
    setReloadKey((value) => value + 1);
  }, [clearLoadTimers, currentVideo?.aweme_id]);

  const markMediaReady = useCallback(() => {
    clearLoadTimers();
    setLoadState("ready");
    setShowLoadStatus(false);
    mediaSwitchingRef.current = false;
  }, [clearLoadTimers]);

  const handleMediaFailure = useCallback(async () => {
    clearLoadTimers();
    stopVideoProgressLoop();
    mediaSwitchingRef.current = false;

    const mediaErrorCode = videoRef.current?.error?.code || 0;
    const canAutoRetry =
      (typeof navigator === "undefined" || navigator.onLine !== false) &&
      (mediaErrorCode === 0 || mediaErrorCode === 2 || mediaErrorCode === 4) &&
      autoRetryCountRef.current < PLAYER_VIDEO_MAX_AUTO_RETRIES;

    if (canAutoRetry) {
      autoRetryCountRef.current += 1;
      retryCurrentMedia(undefined, true);
      return;
    }
    const refreshed = await refreshCurrentVideoDetail();
    if (refreshed) return;
    setLoadState("error");
    setPlaying(false);
    setShowLoadStatus(true);
  }, [clearLoadTimers, refreshCurrentVideoDetail, retryCurrentMedia, stopVideoProgressLoop]);
  const handleImageLoad = useCallback(() => {
    markMediaReady();
    releaseMediaSwitchSoon();
    if (desiredPlayingRef.current) {
      setPlaying(true);
    }
  }, [markMediaReady, releaseMediaSwitchSoon]);
  const handleImageError = useCallback(() => {
    void handleMediaFailure();
  }, [handleMediaFailure]);
  const scheduleLoadTimeout = useCallback(() => {
    if (loadTimeoutTimerRef.current) {
      window.clearTimeout(loadTimeoutTimerRef.current);
    }

    loadTimeoutTimerRef.current = window.setTimeout(() => {
      const node = videoRef.current;
      if (!currentMedia || !isVideoLikeMedia(currentMedia)) return;
      if (!desiredPlayingRef.current || node?.paused) return;
      if (node && node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
      void handleMediaFailure();
    }, PLAYER_VIDEO_LOAD_TIMEOUT_MS);
  }, [currentMedia?.type, currentMedia?.url, handleMediaFailure]);

  const showBufferingSoon = useCallback(() => {
    if (bufferingTimerRef.current) {
      window.clearTimeout(bufferingTimerRef.current);
    }
    bufferingTimerRef.current = window.setTimeout(() => {
      const node = videoRef.current;
      if (!desiredPlayingRef.current || node?.paused) return;
      if (node && node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
      setLoadState("loading");
      setShowLoadStatus(true);
    }, PLAYER_VIDEO_REBUFFER_STATUS_DELAY_MS);
  }, []);

  const preloadMediaItem = useCallback((media: VideoMediaItem | null | undefined, full = false) => {
    const target = resolvePreloadTarget(media);
    if (!target || !media) return;

    const existingFullPreload = preloadedMediaRef.current.get(target.key);
    if (existingFullPreload || (!full && preloadedMediaRef.current.has(target.key))) return;
    preloadedMediaRef.current.set(target.key, full);

    if (media.type === "image") {
      const image = new Image();
      image.decoding = "async";
      image.loading = "eager";
      image.onload = () => {
        if (image.naturalWidth > 0) {
          preloadedReadyRef.current.add(target.key);
        }
      };
      image.src = target.url;
      if (image.complete && image.naturalWidth > 0) {
        preloadedReadyRef.current.add(target.key);
      }
      rememberPreloadedNode(image);
    } else {
      const video = document.createElement("video");
      video.preload = full ? "auto" : "metadata";
      video.muted = true;
      video.playsInline = true;
      const markReady = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          preloadedReadyRef.current.add(target.key);
        }
      };
      video.addEventListener("loadeddata", markReady, { once: true });
      video.addEventListener("canplay", markReady, { once: true });
      video.src = target.url;
      video.load();
      markReady();
      rememberPreloadedNode(video);
    }
  }, [rememberPreloadedNode, resolvePreloadTarget]);

  const releasePreloadedMedia = useCallback(() => {
    preloadedMediaRef.current.clear();
    preloadedReadyRef.current.clear();
    for (const node of preloadedNodesRef.current) {
      if (node instanceof HTMLVideoElement) {
        releaseMediaElement(node);
      } else {
        node.removeAttribute("src");
      }
    }
    preloadedNodesRef.current = [];
  }, []);

  const preloadVideoAtIndex = useCallback((index: number, full = false) => {
    const video = videos[index];
    if (!video) return;
    const firstMedia = collectVideoMedia(video)[0];
    preloadMediaItem(firstMedia, full);
  }, [preloadMediaItem, videos]);

  const releasePlayerMediaResources = useCallback(() => {
    mediaAdvanceSeqRef.current += 1;
    desiredPlayingRef.current = false;
    playingRef.current = false;
    mediaSwitchingRef.current = false;
    qualitySwitchingRef.current = false;
    clearLoadTimers();
    stopVideoProgressLoop();
    releaseMediaElement(videoRef.current);
    releaseScopedMediaElements(playerRootRef.current);
    releaseBgm();
    releasePreloadedMedia();
  }, [clearLoadTimers, releaseBgm, releasePreloadedMedia, stopVideoProgressLoop]);

  const closePlayer = useCallback(() => {
    wasOpenRef.current = false;
    releasePlayerMediaResources();
    setPlaying(false);
    setShowLoadStatus(false);
    onClose();
  }, [onClose, releasePlayerMediaResources]);

  useEffect(() => {
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      playerRootRef.current?.focus({ preventScroll: true });
    }, 0);

    const safeIndex = Math.min(Math.max(initialIndex, 0), Math.max(videos.length - 1, 0));
    const initialMediaCount = collectVideoMedia(videos[safeIndex]).length;
    const safeMediaIndex = Math.min(
      Math.max(initialMediaIndex, 0),
      Math.max(initialMediaCount - 1, 0)
    );
    desiredPlayingRef.current = true;
    mediaSwitchingRef.current = false;
    setCurrentIndex(safeIndex);
    setMediaTransition({ index: safeMediaIndex, direction: 0 });
    setCurrentTime(0);
    setDuration(0);
    progressSampleRef.current = 0;
    setPlaying(false);
    return () => window.clearTimeout(focusTimer);
  }, [initialIndex, initialMediaIndex, initialVideoKey, open]);

  useEffect(() => {
    return () => {
      if (mediaSwitchReleaseRef.current) {
        window.clearTimeout(mediaSwitchReleaseRef.current);
      }
      if (qualitySwitchReleaseRef.current) {
        window.clearTimeout(qualitySwitchReleaseRef.current);
      }
      if (panelCloseTimerRef.current) {
        window.clearTimeout(panelCloseTimerRef.current);
      }
      if (navigationNoticeTimerRef.current) {
        window.clearTimeout(navigationNoticeTimerRef.current);
      }
      clearLoadTimers();
      stopVideoProgressLoop();
      releaseBgm();
      releasePreloadedMedia();
      releaseMediaElement(videoRef.current);
      releaseScopedMediaElements(playerRootRef.current);
    };
  }, [clearLoadTimers, releaseBgm, releasePreloadedMedia, stopVideoProgressLoop]);

  useEffect(() => {
    if (open) return;
    setPlaying(false);
    setShowLoadStatus(false);
    releasePlayerMediaResources();
  }, [open, releasePlayerMediaResources]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || videos.length === 0) return;
    if (currentIndex >= videos.length) {
      goToVideo(videos.length - 1);
    }
  }, [currentIndex, goToVideo, open, videos.length]);

  useEffect(() => {
    if (mediaIndex < mediaItems.length) return;
    setMediaTransition({ index: 0, direction: 0 });
  }, [mediaIndex, mediaItems.length]);

  useEffect(() => {
    pendingQualitySeekRef.current = null;
    setSelectedQualityKey("auto");
  }, [currentMedia?.url, currentVideo?.aweme_id, mediaIndex]);

  useEffect(() => {
    if (qualityOptions.length === 0) {
      if (selectedQualityKey !== "auto") setSelectedQualityKey("auto");
      return;
    }
    if (qualityOptions.some((option) => option.key === selectedQualityKey)) return;
    setSelectedQualityKey("auto");
  }, [qualityOptions, selectedQualityKey]);

  useEffect(() => {
    autoRetryCountRef.current = 0;
  }, [currentMedia?.url, currentVideo?.aweme_id, mediaIndex, selectedQualityKey]);



  useEffect(() => {
    imageAdvanceQueued.current = false;
    setShowLoadStatus(false);
    clearLoadTimers();

    if (!currentMedia || currentMedia.type === "image") {
      setCurrentTime(0);
      setDuration(currentMedia?.type === "image" ? IMAGE_DURATION_SECONDS : 0);
    }
    progressSampleRef.current = 0;
    setLoadState(currentMedia ? "loading" : "error");
    setPlaying(Boolean(currentMedia && desiredPlayingRef.current));

    if (currentMedia && isVideoLikeMedia(currentMedia)) {
      loadStatusTimerRef.current = window.setTimeout(() => {
        const node = videoRef.current;
        if (node && node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
        setShowLoadStatus(true);
      }, PLAYER_VIDEO_INITIAL_STATUS_DELAY_MS);
      scheduleLoadTimeout();
      if (mediaItems.length > 1) {
        const nextIndex = (mediaIndex + 1) % mediaItems.length;
        preloadMediaItem(mediaItems[nextIndex], true);
      }
    }
  }, [clearLoadTimers, currentMedia?.type, currentMedia?.url, mediaIndex, mediaKey, preloadMediaItem, scheduleLoadTimeout]);

  useEffect(() => {
    if (!open || !currentVideo || mediaItems.length > 0) return;
    void refreshCurrentVideoDetail().then((refreshed) => {
      if (refreshed) return;
      setLoadState("error");
      setShowLoadStatus(true);
    });
  }, [currentVideo, mediaItems.length, open, refreshCurrentVideoDetail]);

  useEffect(() => {
    if (!open || !onLoadMore || videos.length === 0) return;
    const remaining = videos.length - currentIndex - 1;
    if (remaining > LOAD_MORE_THRESHOLD) return;
    if (loadMoreRequestedForLength.current === videos.length) return;
    loadMoreRequestedForLength.current = videos.length;
    onLoadMore();
  }, [currentIndex, onLoadMore, open, videos.length]);

  useEffect(() => {
    if (!open || !currentMedia || !isVideoLikeMedia(currentMedia)) return;
    if (duration <= 0 || currentTime <= 0) return;
    if (duration - currentTime > PLAYER_NEXT_VIDEO_PRELOAD_AHEAD_SECONDS) return;
    preloadVideoAtIndex(currentIndex + 1, false);
  }, [currentIndex, currentMedia, currentTime, duration, open, preloadVideoAtIndex]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      prewarmVideoForPlayback(videos[currentIndex + 1]);
      prewarmVideoForPlayback(videos[currentIndex - 1]);
    }, loadState === "ready" ? 160 : 700);
    return () => window.clearTimeout(timer);
  }, [currentIndex, loadState, open, videos]);

  useEffect(() => {
    releasePreloadedMedia();
  }, [currentVideo?.aweme_id, releasePreloadedMedia]);

  useEffect(() => {
    if (!open || mediaItems.length <= 1 || loadState !== "ready") return;

    const orderedIndexes = Array.from(
      new Set([
        (mediaIndex + 1) % mediaItems.length,
        (mediaIndex - 1 + mediaItems.length) % mediaItems.length,
      ])
    ).filter((index) => index !== mediaIndex);
    let cancelled = false;
    const timers: number[] = [];

    orderedIndexes.forEach((index, order) => {
      const timer = window.setTimeout(() => {
        if (cancelled) return;
        preloadMediaItem(mediaItems[index], true);
      }, order * 140);
      timers.push(timer);
    });

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [loadState, mediaIndex, mediaItems, open, preloadMediaItem]);

  useEffect(() => {
    if (!open || !currentMedia || !isVideoLikeMedia(currentMedia)) return;
    const frame = window.requestAnimationFrame(() => {
      const node = videoRef.current;
      if (!node || !desiredPlayingRef.current) return;
      resumeVideoIfDesired(node);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentMedia, mediaKey, open, resumeVideoIfDesired]);



  useEffect(() => {
    const nextVolume = effectiveVolume / 100;
    const video = videoRef.current;
    if (video) {
      video.volume = nextVolume;
      video.muted = shouldUseBgmForCurrentMedia || muted || volume === 0;
      applyPlaybackRateToNode(video, playbackRateRef.current);
    }

    const audio = bgmRef.current;
    if (audio) {
      audio.volume = nextVolume;
      audio.muted = muted || volume === 0;
      applyPlaybackRateToNode(audio, playbackRateRef.current);
    }
  }, [effectiveVolume, mediaKey, muted, shouldUseBgmForCurrentMedia, volume]);

  useEffect(() => {
    syncPlaybackRate(playbackRate);
    const frame = window.requestAnimationFrame(() => syncPlaybackRate(playbackRate));
    const timer = window.setTimeout(() => syncPlaybackRate(playbackRate), 160);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [mediaKey, playbackRate, syncPlaybackRate]);

  useEffect(() => {
    stopVideoProgressLoop();
    return stopVideoProgressLoop;
  }, [mediaKey, stopVideoProgressLoop]);

  useEffect(() => {
    // 单图作品且不自动播放下一个视频时，静止显示——不推进进度循环，
    // 否则到 IMAGE_DURATION_SECONDS 会触发 reloadKey 自增导致图片重新加载
    // 闪烁、进度条在 1/3↔2/3 间来回跳。
    const isSingleStaticImage =
      currentMedia?.type === "image" && mediaItems.length <= 1 && !(autoPlayNextVideo && videos.length > 1);
    if (!open || currentMedia?.type !== "image" || !playing || isSingleStaticImage) return;

    let timer = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const delta = Math.max(0, now - last) / 1000;
      last = now;

      setCurrentTime((value) => {
        const next = Math.min(IMAGE_DURATION_SECONDS, value + delta * playbackRateRef.current);
        if (next >= IMAGE_DURATION_SECONDS && !imageAdvanceQueued.current) {
          imageAdvanceQueued.current = true;
          requestAdvanceMediaSequence();
        }
        return next;
      });

      if (!imageAdvanceQueued.current) {
        timer = window.setTimeout(tick, IMAGE_PROGRESS_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(tick, IMAGE_PROGRESS_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [currentMedia?.type, mediaKey, open, playing, requestAdvanceMediaSequence, mediaItems.length, autoPlayNextVideo, videos.length]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      const key = event.key;
      const lowerKey = key.toLowerCase();
      const isEditableTarget = isKeyboardInputTarget(event.target);
      let handled = true;

      if (key === "Escape") {
        closePlayer();
      } else if (isEditableTarget) {
        handled = false;
      } else if (key === "ArrowUp" || lowerKey === "k") {
        playPrevVideo();
      } else if (key === "ArrowDown" || lowerKey === "j") {
        playNextVideo();
      } else if (key === "ArrowLeft") {
        playPrevMedia();
      } else if (key === "ArrowRight") {
        playNextMedia();
      } else if (key === " ") {
        togglePlay();
      } else {
        handled = false;
      }

      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [closePlayer, open, playNextMedia, playNextVideo, playPrevMedia, playPrevVideo, togglePlay]);




  return (
    <AnimatePresence>
      {open && currentVideo && (
        <motion.div
          ref={playerRootRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-black text-white"
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <TopCloseOverlay onClose={closePlayer} />

          <PlayerMediaStage
            mediaKey={mediaKey}
            mediaTransitionDirection={mediaTransitionDirection}
            currentMedia={currentMedia}
            currentMediaSrc={currentMediaSrc}
            currentVideo={currentVideo}
            shouldAutoPlayCurrentMedia={shouldAutoPlayCurrentMedia}
            autoPlayNextVideo={autoPlayNextVideo}
            hasMultipleMedia={hasMultipleMedia}
            shouldUseBgmForCurrentMedia={shouldUseBgmForCurrentMedia}
            muted={muted}
            volume={volume}
            playing={playing}
            loadState={loadState}
            showLoadStatus={showLoadStatus}
            navigationNotice={navigationNotice}
            setVideoElementRef={setVideoElementRef}
            surfaceHitRef={surfaceHitRef}
            handleSurfacePointerDown={handleSurfacePointerDown}
            handleSurfacePointerUp={handleSurfacePointerUp}
            handleSurfacePointerCancel={handleSurfacePointerCancel}
            handleSurfaceMouseDown={handleSurfaceMouseDown}
            handleSurfaceMouseUp={handleSurfaceMouseUp}
            handleSurfaceTouchStart={handleSurfaceTouchStart}
            handleSurfaceTouchEnd={handleSurfaceTouchEnd}
            handleSurfaceClick={handleSurfaceClick}
            scheduleLoadTimeout={scheduleLoadTimeout}
            showBufferingSoon={showBufferingSoon}
            onLoadedMetadata={(event) => {
              applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current);
              restorePendingQualitySeek(event.currentTarget);
              syncVideoProgress(event.currentTarget);
              event.currentTarget.volume = effectiveVolume / 100;
              event.currentTarget.muted = shouldUseBgmForCurrentMedia || muted || volume === 0;
              if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                markMediaReady();
              }
              resumeVideoIfDesired(event.currentTarget);
            }}
            onLoadedData={(event) => {
              applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current);
              syncVideoProgress(event.currentTarget);
              markMediaReady();
              resumeVideoIfDesired(event.currentTarget);
            }}
            onDurationChange={(event) => {
              syncVideoProgress(event.currentTarget);
            }}
            onCanPlay={(event) => {
              applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current);
              restorePendingQualitySeek(event.currentTarget);
              syncVideoProgress(event.currentTarget);
              markMediaReady();
              releaseMediaSwitchSoon();
              resumeVideoIfDesired(event.currentTarget);
            }}
            onTimeUpdate={(event) => {
              syncVideoProgress(event.currentTarget);
              if (loadState !== "ready" && event.currentTarget.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                markMediaReady();
              }
            }}
            onSeeking={(event) => syncVideoProgress(event.currentTarget)}
            onSeeked={(event) => syncVideoProgress(event.currentTarget)}
            onPlay={(event) => {
              applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current);
              desiredPlayingRef.current = true;
              playingRef.current = true;
              syncVideoProgress(event.currentTarget);
              setPlaying(true);
              startVideoProgressLoop();
            }}
            onPlaying={(event) => {
              applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current);
              qualitySwitchingRef.current = false;
              if (qualitySwitchReleaseRef.current) {
                window.clearTimeout(qualitySwitchReleaseRef.current);
                qualitySwitchReleaseRef.current = null;
              }
              playingRef.current = true;
              syncVideoProgress(event.currentTarget);
              if (loadState !== "ready") {
                markMediaReady();
              }
              setPlaying(true);
              startVideoProgressLoop();
            }}
            onPause={(event) => {
              stopVideoProgressLoop();
              if (qualitySwitchingRef.current && desiredPlayingRef.current) {
                window.setTimeout(() => resumeVideoIfDesired(event.currentTarget), 80);
                return;
              }
              if ((mediaSwitchingRef.current || event.currentTarget.ended) && desiredPlayingRef.current) {
                return;
              }
              if (!mediaSwitchingRef.current) {
                clearLoadTimers();
                playingRef.current = false;
                setPlaying(false);
                desiredPlayingRef.current = false;
                setShowLoadStatus(false);
                setLoadState("ready");
              }
            }}
            onRateChange={(event) => {
              applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current);
            }}
            onEnded={() => {
              desiredPlayingRef.current = true;
              mediaSwitchingRef.current = true;
              setPlaying(true);
              stopVideoProgressLoop();
              advanceMediaSequence();
            }}
            onError={() => {
              void handleMediaFailure();
            }}
            onImageLoad={handleImageLoad}
            onImageError={handleImageError}
            retryCurrentMedia={retryCurrentMedia}
          />

          <div
            className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2 pt-20 text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <AuthorInfo
                authorAvatar={authorAvatar}
                authorName={authorName}
                canOpenAuthor={canOpenAuthor}
                onAuthorClick={() => {
                  if (!currentVideo || !canOpenAuthor) return;
                  releasePlayerMediaResources();
                  onAuthor?.(currentVideo);
                }}
              />

              <PlayerActionButtons
                showWorkActions={showWorkActions}
                liked={liked}
                favorited={favorited}
                likeCount={likeCount}
                favoriteCount={favoriteCount}
                relationSubmitting={relationSubmitting}
                autoPlayNextVideo={autoPlayNextVideo}
                openPanel={openPanel}
                muted={muted}
                volume={volume}
                effectiveVolume={effectiveVolume}
                playbackRate={playbackRate}
                qualityOptions={qualityOptions}
                activeQualityOption={displayQualityOption}
                showQualityControl={showQualityControl}
                shareFriends={shareFriends}
                shareFriendsLoading={shareFriendsLoading}
                shareFriendsError={shareFriendsError}
                shareSendingFriendKey={shareSendingFriendKey}
                shareSentFriendKeys={shareSentFriendKeys}
                downloadSubmitting={downloadSubmitting}
                musicUrl={musicUrl}
                bgmPlaying={bgmPlaying}
                bgmProxyUrl={bgmProxyUrl}
                bgmDownloadSubmitting={bgmDownloadSubmitting}
                canDownloadBgm={Boolean(onDownload)}
                hasDownloadHandler={Boolean(onDownload)}
                commentsOpen={commentsOpen}
                comments={comments}
                commentsLoading={commentsLoading}
                commentsError={commentsError}
                commentsHasMore={commentsHasMore}
                commentsTotal={commentsTotal}
                commentReplies={commentReplies}
                expandedCommentReplyIds={expandedCommentReplyIds}
                commentDiggingIds={commentDiggingIds}
                commentDraft={commentDraft}
                commentSubmitting={commentSubmitting}
                commentAiSuggesting={commentAiSuggesting}
                commentAiSuggestions={commentAiSuggestions}
                commentAiHint={commentAiHint}
                commentReplyTarget={commentReplyTarget}
                currentVideoCommentCount={currentVideo?.statistics?.comment_count || 0}
                onToggleLike={(event) => {
                  event.stopPropagation();
                  void toggleLike();
                }}
                onToggleAutoPlayNextVideo={(event) => {
                  event.stopPropagation();
                  toggleAutoPlayNextVideo();
                }}
                onToggleCollect={(event) => {
                  event.stopPropagation();
                  void toggleCollect();
                }}
                onToggleMute={toggleMute}
                onVolumeChange={handleVolumeChange}
                onPlaybackRateChange={handlePlaybackRateChange}
                onQualityChange={handleQualityChange}
                onShareFriendClick={handleShareFriendClick}
                onDownloadCurrent={handleDownloadCurrent}
                onCopyCurrentMediaUrl={copyCurrentMediaUrl}
                onToggleBgm={toggleBgm}
                onDownloadBgm={handleDownloadBgm}
                onShowDetail={() => {
                  releasePlayerMediaResources();
                  onShowDetail?.(currentVideo);
                }}
                onTogglePanel={togglePanel}
                onOpenPanelOnPointerEnter={openPanelOnPointerEnter}
                onClosePanelOnPointerLeave={closePanelOnPointerLeave}
                onOpenToolPanel={openToolPanel}
                onSchedulePanelClose={schedulePanelClose}
                onOpenPanelOnPointerDown={openPanelOnPointerDown}
                onCommentsScroll={handleCommentsScroll}
                onToggleCommentReplies={toggleCommentReplies}
                onToggleCommentLike={toggleCommentLike}
                onSetCommentReplyTarget={setCommentReplyTarget}
                onCommentDraftChange={setCommentDraft}
                onSubmitComment={submitComment}
                onSuggestCommentDraft={suggestCommentDraft}
                onApplyCommentAiSuggestion={applyCommentAiSuggestion}
                onLoadCommentReplies={loadCommentReplies}
                onLoadMoreComments={() => void loadComments("more")}
                onCloseCommentsPanel={closeCommentsPanel}
                onOpenCommentsPanel={openCommentsPanel}
                onMarkCommentsPanelSticky={markCommentsPanelSticky}
                onScheduleTransientCommentsClose={scheduleTransientCommentsClose}
                onClearPanelCloseTimer={clearPanelCloseTimer}
                registerCommentRef={registerCommentRef}
                registerReplyRef={registerReplyRef}
                highlightCid={highlightCid}
                locatePrompt={locatePrompt}
                onDismissLocatePrompt={() => setLocatePrompt("")}
              />
            </div>
            <div className="mt-0.5">
              <PlayerPlaybackBar
                duration={duration}
                currentTime={currentTime}
                progressPct={progressPct}
                mediaItems={mediaItems}
                activeMediaIndex={activeMediaIndex}
                previewSrc={currentMedia && isVideoLikeMedia(currentMedia) ? currentMediaSrc : ""}
                onSeek={handleSeek}
                onSelectMedia={switchToMedia}
              />
              <PlayerDescription currentVideo={currentVideo} />
            </div>
          </div>
          <audio
            ref={bgmRef}
            className="hidden"
            onLoadedMetadata={(event) => applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current)}
            onCanPlay={(event) => applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current)}
            onPlay={(event) => applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current)}
            onRateChange={(event) => applyPlaybackRateToNode(event.currentTarget, playbackRateRef.current)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
