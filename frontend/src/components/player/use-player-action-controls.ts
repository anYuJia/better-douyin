import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { copyTextToClipboard, type VideoInfo } from "@/lib/tauri";
import {
  applyPlaybackRateToNode,
  finiteMediaTime,
  getDocumentVideoNode,
  playerMediaProxyUrl,
  readMediaDuration,
} from "./player-utils";
import { getMediaProxyType, isVideoLikeMedia, type VideoMediaItem, type VideoQualityOption } from "@/lib/video-media";
import type { PlayerPanel } from "./player-types";

// Delay in ms to close the panel when mouse leaves
const PLAYER_PANEL_CLOSE_DELAY_MS = 220;

interface UsePlayerActionControlsProps {
  openPanel: PlayerPanel | null;
  setOpenPanel: React.Dispatch<React.SetStateAction<PlayerPanel | null>>;
  volume: number;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  muted: boolean;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;
  playbackRate: number;
  setPlaybackRate: React.Dispatch<React.SetStateAction<number>>;
  currentPlaybackUrl: string;
  currentMedia: VideoMediaItem | null;
  currentVideo: VideoInfo | null;
  onDownload?: (video: VideoInfo) => void | Promise<void>;
  downloadSubmitting: boolean;
  setDownloadSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  reloadKey: number;
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setLoadState: React.Dispatch<React.SetStateAction<"loading" | "ready" | "error">>;
  setShowLoadStatus: React.Dispatch<React.SetStateAction<boolean>>;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  effectiveVolume: number;
  shouldUseBgmForCurrentMedia: boolean;
  selectedQualityKey: string;
  setSelectedQualityKey: React.Dispatch<React.SetStateAction<string>>;
  qualityOptions: VideoQualityOption[];

  // Refs:
  videoRef: React.RefObject<HTMLVideoElement | null>;
  bgmRef: React.RefObject<HTMLAudioElement | null>;
  playerRootRef: React.RefObject<HTMLDivElement | null>;
  playbackRateRef: React.MutableRefObject<number>;
  playingRef: React.MutableRefObject<boolean>;
  desiredPlayingRef: React.MutableRefObject<boolean>;
  mediaSwitchingRef: React.MutableRefObject<boolean>;
  qualitySwitchingRef: React.MutableRefObject<boolean>;
  qualitySwitchReleaseRef: React.MutableRefObject<ReturnType<typeof window.setTimeout> | null>;
  pendingQualitySeekRef: React.MutableRefObject<number | null>;
  panelCloseTimerRef: React.MutableRefObject<ReturnType<typeof window.setTimeout> | null>;

  // Callbacks:
  startVideoProgressLoop: () => void;
}

export function usePlayerActionControls({
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
}: UsePlayerActionControlsProps) {
  const clearPanelCloseTimer = useCallback(() => {
    if (!panelCloseTimerRef.current) return;
    window.clearTimeout(panelCloseTimerRef.current);
    panelCloseTimerRef.current = null;
  }, [panelCloseTimerRef]);

  const openToolPanel = useCallback((panel: PlayerPanel) => {
    clearPanelCloseTimer();
    setOpenPanel(panel);
  }, [clearPanelCloseTimer, setOpenPanel]);

  const schedulePanelClose = useCallback((panel?: PlayerPanel) => {
    clearPanelCloseTimer();
    panelCloseTimerRef.current = window.setTimeout(() => {
      setOpenPanel((value) => (!panel || value === panel ? null : value));
      panelCloseTimerRef.current = null;
    }, PLAYER_PANEL_CLOSE_DELAY_MS);
  }, [clearPanelCloseTimer, panelCloseTimerRef, setOpenPanel]);

  const openPanelOnPointerEnter = useCallback((panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    openToolPanel(panel);
  }, [openToolPanel]);

  const closePanelOnPointerLeave = useCallback((panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    schedulePanelClose(panel);
  }, [schedulePanelClose]);

  const togglePanel = useCallback((panel: PlayerPanel, event: ReactMouseEvent) => {
    event.stopPropagation();
    clearPanelCloseTimer();
    setOpenPanel(panel);
  }, [clearPanelCloseTimer, setOpenPanel]);

  const openPanelOnPointerDown = useCallback((panel: PlayerPanel, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    clearPanelCloseTimer();
    setOpenPanel(panel);
  }, [clearPanelCloseTimer, setOpenPanel]);

  const copyCurrentMediaUrl = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
    const url = currentPlaybackUrl || currentMedia?.url || "";
    if (!url) return;
    void copyTextToClipboard(url).then((success) => {
      if (success) setOpenPanel(null);
    });
  }, [currentMedia?.url, currentPlaybackUrl, setOpenPanel]);

  const handleDownloadCurrent = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
    clearPanelCloseTimer();
    setOpenPanel(null);

    if (!currentVideo || !onDownload || downloadSubmitting) return;

    setDownloadSubmitting(true);
    Promise.resolve(onDownload(currentVideo)).finally(() => {
      window.setTimeout(() => setDownloadSubmitting(false), 350);
    });
  }, [clearPanelCloseTimer, currentVideo, downloadSubmitting, onDownload, setDownloadSubmitting, setOpenPanel]);

  const toggleMute = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
    if (muted && volume === 0) {
      setVolume(50);
    }
    setMuted((value) => !value);
  }, [muted, setMuted, setVolume, volume]);

  const handleVolumeChange = useCallback((nextVolume: number) => {
    const safeVolume = Math.max(0, Math.min(100, nextVolume));
    setVolume(safeVolume);
    setMuted(safeVolume === 0);
  }, [setMuted, setVolume]);

  const syncPlaybackRate = useCallback((rate: number) => {
    playbackRateRef.current = rate;
    applyPlaybackRateToNode(videoRef.current || getDocumentVideoNode(playerRootRef.current), rate);
    applyPlaybackRateToNode(bgmRef.current, rate);
  }, [bgmRef, playbackRateRef, playerRootRef, videoRef]);

  const handlePlaybackRateChange = useCallback((rate: number, event: ReactMouseEvent) => {
    event.stopPropagation();
    setPlaybackRate(rate);
    syncPlaybackRate(rate);
    window.requestAnimationFrame(() => syncPlaybackRate(rate));
    window.setTimeout(() => syncPlaybackRate(rate), 120);
    setOpenPanel(null);
  }, [setOpenPanel, setPlaybackRate, syncPlaybackRate]);

  const handleQualityChange = useCallback((qualityKey: string, event: ReactMouseEvent) => {
    event.stopPropagation();
    if (qualityKey === selectedQualityKey) {
      setOpenPanel(null);
      return;
    }

    const nextQualityOption = qualityOptions.find((option) => option.key === qualityKey);
    const nextPlaybackUrl =
      currentMedia && currentMedia.type === "video" && nextQualityOption
        ? nextQualityOption.url
        : currentMedia?.url || "";
    const nextMediaSrc = currentMedia
      ? playerMediaProxyUrl(nextPlaybackUrl, getMediaProxyType(currentMedia), reloadKey)
      : "";
    const node = videoRef.current || getDocumentVideoNode(playerRootRef.current);
    const nextTime = node ? finiteMediaTime(node.currentTime) : currentTime;
    const shouldResume = playingRef.current || desiredPlayingRef.current;
    pendingQualitySeekRef.current = nextTime > 0 ? nextTime : null;
    desiredPlayingRef.current = shouldResume;
    mediaSwitchingRef.current = true;
    qualitySwitchingRef.current = true;
    if (qualitySwitchReleaseRef.current) {
      window.clearTimeout(qualitySwitchReleaseRef.current);
    }
    qualitySwitchReleaseRef.current = window.setTimeout(() => {
      qualitySwitchingRef.current = false;
      qualitySwitchReleaseRef.current = null;
    }, 8000);
    setSelectedQualityKey(qualityKey);
    setPlaying(shouldResume);
    setLoadState("loading");
    setShowLoadStatus(true);
    setDuration(0);
    setOpenPanel(null);

    if (node && nextMediaSrc) {
      node.src = nextMediaSrc;
      node.volume = effectiveVolume / 100;
      const targetMuted = shouldUseBgmForCurrentMedia || muted || volume === 0;
      node.muted = shouldResume && !targetMuted ? true : targetMuted;
      applyPlaybackRateToNode(node, playbackRateRef.current);
      node.load();
      if (shouldResume) {
        void node.play().then(() => {
          node.muted = targetMuted;
          playingRef.current = true;
          setPlaying(true);
          startVideoProgressLoop();
        }).catch(() => {
          node.muted = targetMuted;
          setPlaying(false);
        });
      }
    }
  }, [
    currentMedia,
    currentTime,
    effectiveVolume,
    muted,
    playbackRateRef,
    qualityOptions,
    reloadKey,
    selectedQualityKey,
    shouldUseBgmForCurrentMedia,
    startVideoProgressLoop,
    volume,
    videoRef,
    playerRootRef,
    playingRef,
    desiredPlayingRef,
    mediaSwitchingRef,
    qualitySwitchingRef,
    qualitySwitchReleaseRef,
    pendingQualitySeekRef,
    setSelectedQualityKey,
    setPlaying,
    setLoadState,
    setShowLoadStatus,
    setDuration,
    setOpenPanel,
  ]);

  const restorePendingQualitySeek = useCallback((node: HTMLVideoElement) => {
    const pendingTime = pendingQualitySeekRef.current;
    if (!pendingTime || pendingTime <= 0) return;

    const nodeDuration = readMediaDuration(node);
    const safeTime = nodeDuration > 0 ? Math.min(pendingTime, Math.max(0, nodeDuration - 0.15)) : pendingTime;
    try {
      node.currentTime = safeTime;
      setCurrentTime(safeTime);
      pendingQualitySeekRef.current = null;
    } catch {
      // Some streams reject early seeking until canplay; the next metadata event will keep playback usable.
    }
  }, [pendingQualitySeekRef, setCurrentTime]);

  const resumeVideoIfDesired = useCallback((node: HTMLVideoElement) => {
    if (!desiredPlayingRef.current || !currentMedia || !isVideoLikeMedia(currentMedia)) return;
    const targetMuted = shouldUseBgmForCurrentMedia || muted || volume === 0;
    const shouldTemporarilyMute = qualitySwitchingRef.current && !targetMuted;
    if (!node.paused) {
      node.muted = targetMuted;
      setPlaying(true);
      startVideoProgressLoop();
      return;
    }

    if (shouldTemporarilyMute) {
      node.muted = true;
    }
    void node.play().then(() => {
      node.muted = targetMuted;
      playingRef.current = true;
      setPlaying(true);
      startVideoProgressLoop();
    }).catch(() => {
      node.muted = targetMuted;
      setPlaying(false);
    });
  }, [currentMedia, desiredPlayingRef, muted, playingRef, setPlaying, shouldUseBgmForCurrentMedia, startVideoProgressLoop, volume, qualitySwitchingRef]);

  return {
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
  };
}
