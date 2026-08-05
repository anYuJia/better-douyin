import { useCallback, useRef } from "react";
import { finiteMediaTime, readMediaDuration } from "./player-utils";

const VIDEO_PROGRESS_INTERVAL_MS = 50;

interface UsePlayerProgressLoopProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
}

export function usePlayerProgressLoop({
  videoRef,
  setCurrentTime,
  setDuration,
}: UsePlayerProgressLoopProps) {
  const videoProgressTimerRef = useRef<number | null>(null);
  const progressSampleRef = useRef(0);

  const stopVideoProgressLoop = useCallback(() => {
    if (videoProgressTimerRef.current === null) return;
    window.clearTimeout(videoProgressTimerRef.current);
    videoProgressTimerRef.current = null;
  }, []);

  const syncVideoProgress = useCallback((node: HTMLVideoElement) => {
    const nextTime = finiteMediaTime(node.currentTime);
    const nextDuration = readMediaDuration(node);
    setCurrentTime((current) => {
      if (nextTime > 0 || current <= 0) return nextTime;
      if (node.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || nextDuration <= 0) {
        return current;
      }
      return nextTime;
    });
    if (nextDuration > 0) {
      setDuration(nextDuration);
    }
  }, [setCurrentTime, setDuration]);

  const startVideoProgressLoop = useCallback(() => {
    if (videoProgressTimerRef.current !== null) return;

    const tick = () => {
      const node = videoRef.current;
      if (!node) {
        videoProgressTimerRef.current = null;
        return;
      }

      progressSampleRef.current = performance.now();
      syncVideoProgress(node);

      if (!node.paused && !node.ended) {
        videoProgressTimerRef.current = window.setTimeout(tick, VIDEO_PROGRESS_INTERVAL_MS);
      } else {
        videoProgressTimerRef.current = null;
      }
    };

    videoProgressTimerRef.current = window.setTimeout(tick, 0);
  }, [syncVideoProgress, videoRef]);

  return {
    stopVideoProgressLoop,
    syncVideoProgress,
    startVideoProgressLoop,
    videoProgressTimerRef,
    progressSampleRef,
  };
}
