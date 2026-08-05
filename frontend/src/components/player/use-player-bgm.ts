import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { type VideoInfo } from "@/lib/tauri";
import { applyPlaybackRateToNode, releaseMediaElement } from "./player-utils";
import type { VideoMediaItem } from "@/lib/video-media";

interface UsePlayerBgmProps {
  open: boolean;
  currentVideo: VideoInfo | null;
  currentMedia: VideoMediaItem | null;
  musicUrl: string;
  bgmProxyUrl: string;
  shouldUseBgmForCurrentMedia: boolean;
  effectiveVolume: number;
  muted: boolean;
  volume: number;
  playbackRateRef: React.MutableRefObject<number>;
  loadState: string;
  mediaSwitchingRef: React.MutableRefObject<boolean>;
  desiredPlayingRef: React.MutableRefObject<boolean>;
  bgmRef: React.RefObject<HTMLAudioElement | null>;
}

export function usePlayerBgm({
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
}: UsePlayerBgmProps) {
  const [bgmPlaying, setBgmPlaying] = useState(false);
  const bgmSourceKeyRef = useRef("");
  const bgmDesiredPlayingRef = useRef(false);
  const bgmPlayPendingRef = useRef(false);
  const bgmPlayRequestSeqRef = useRef(0);
  const bgmManuallyPausedRef = useRef(false);

  useEffect(() => {
    bgmManuallyPausedRef.current = false;
  }, [currentVideo?.aweme_id, musicUrl]);

  const ensureBgmSource = useCallback(() => {
    const audio = bgmRef.current;
    if (!audio || !bgmProxyUrl) return null;
    if (bgmSourceKeyRef.current !== bgmProxyUrl) {
      bgmPlayRequestSeqRef.current += 1;
      bgmPlayPendingRef.current = false;
      bgmSourceKeyRef.current = bgmProxyUrl;
      audio.src = bgmProxyUrl;
      audio.loop = true;
      audio.preload = "auto";
      audio.load();
    }
    audio.volume = effectiveVolume / 100;
    audio.muted = muted || volume === 0;
    applyPlaybackRateToNode(audio, playbackRateRef.current);
    return audio;
  }, [bgmProxyUrl, effectiveVolume, muted, playbackRateRef, volume]);

  const playBgm = useCallback(() => {
    if (bgmManuallyPausedRef.current) {
      bgmDesiredPlayingRef.current = false;
      return;
    }
    bgmDesiredPlayingRef.current = true;
    const audio = ensureBgmSource();
    if (!audio) return;
    if (!audio.paused && !audio.ended) {
      bgmPlayPendingRef.current = false;
      setBgmPlaying(true);
      return;
    }
    if (bgmPlayPendingRef.current) return;

    const requestSeq = ++bgmPlayRequestSeqRef.current;
    bgmPlayPendingRef.current = true;
    void audio.play().then(() => {
      if (requestSeq !== bgmPlayRequestSeqRef.current) return;
      bgmPlayPendingRef.current = false;
      if (!bgmDesiredPlayingRef.current || bgmManuallyPausedRef.current) {
        audio.pause();
        setBgmPlaying(false);
        return;
      }
      setBgmPlaying(true);
    }).catch(() => {
      if (requestSeq !== bgmPlayRequestSeqRef.current) return;
      bgmPlayPendingRef.current = false;
      setBgmPlaying(false);
    });
  }, [ensureBgmSource]);

  const pauseBgm = useCallback(() => {
    bgmDesiredPlayingRef.current = false;
    bgmPlayRequestSeqRef.current += 1;
    bgmPlayPendingRef.current = false;
    const audio = bgmRef.current;
    if (!audio) return;
    audio.pause();
    setBgmPlaying(false);
  }, []);

  const releaseBgm = useCallback(() => {
    bgmDesiredPlayingRef.current = false;
    bgmPlayRequestSeqRef.current += 1;
    bgmPlayPendingRef.current = false;
    const audio = bgmRef.current;
    bgmSourceKeyRef.current = "";
    releaseMediaElement(audio);
    setBgmPlaying(false);
  }, []);

  const toggleBgm = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
    const audio = ensureBgmSource();
    if (!audio) return;
    if (audio.paused) {
      bgmManuallyPausedRef.current = false;
      playBgm();
    } else {
      bgmManuallyPausedRef.current = true;
      pauseBgm();
    }
  }, [ensureBgmSource, pauseBgm, playBgm]);

  useEffect(() => {
    const shouldKeepBgmPlaying = Boolean(
      open &&
        currentMedia &&
        shouldUseBgmForCurrentMedia &&
        desiredPlayingRef.current &&
        loadState !== "error"
    );

    if (shouldKeepBgmPlaying) {
      playBgm();
      return;
    }

    if (
      mediaSwitchingRef.current &&
      bgmDesiredPlayingRef.current &&
      open &&
      currentMedia &&
      musicUrl &&
      loadState !== "error"
    ) {
      return;
    }

    pauseBgm();
  }, [currentMedia, loadState, musicUrl, open, pauseBgm, playBgm, shouldUseBgmForCurrentMedia, desiredPlayingRef, mediaSwitchingRef]);

  useEffect(() => {
    const audio = bgmRef.current;
    if (!audio) return;

    const handlePlay = () => setBgmPlaying(true);
    const handlePause = () => setBgmPlaying(false);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handlePause);
    audio.addEventListener("emptied", handlePause);
    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handlePause);
      audio.removeEventListener("emptied", handlePause);
    };
  }, []);

  return {
    bgmPlaying,
    setBgmPlaying,
    bgmRef,
    bgmDesiredPlayingRef,
    bgmManuallyPausedRef,
    playBgm,
    pauseBgm,
    releaseBgm,
    toggleBgm,
    ensureBgmSource,
  };
}
