import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from "react";
import { getDocumentVideoNode, normalizeWheelDelta } from "./player-utils";

// Threshold in pixels to trigger next/prev video on mouse wheel
const WHEEL_VIDEO_SWITCH_THRESHOLD = 80;
// Time in ms to lock wheel events after a transition
const WHEEL_VIDEO_SWITCH_LOCK_MS = 520;
// Time in ms to reset accumulated wheel delta
const WHEEL_IDLE_RESET_MS = 160;

interface UsePlayerSurfaceEventsProps {
  open: boolean;
  surfaceHitRef: React.RefObject<HTMLDivElement | null>;
  playerRootRef: React.RefObject<HTMLDivElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  playingRef: React.MutableRefObject<boolean>;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  startVideoProgressLoop: () => void;
  togglePlay: () => void;
  desiredPlayingRef: React.MutableRefObject<boolean>;
  mediaAdvanceSeqRef: React.MutableRefObject<number>;
  playNextMedia: () => void;
  playPrevMedia: () => void;
  playNextVideo: () => void;
  playPrevVideo: () => void;
}

export function usePlayerSurfaceEvents({
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
}: UsePlayerSurfaceEventsProps) {
  const touchStart = useRef({ x: 0, y: 0 });
  const wheelLocked = useRef(false);
  const wheelAccumulatedDeltaRef = useRef(0);
  const wheelResetTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const surfaceTapStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const lastSurfaceToggleAtRef = useRef(0);

  useEffect(() => {
    return () => {
      if (wheelResetTimerRef.current) {
        window.clearTimeout(wheelResetTimerRef.current);
      }
    };
  }, []);

  const togglePlayFromSurface = useCallback((action?: "play" | "pause") => {
    const now = Date.now();
    if (now - lastSurfaceToggleAtRef.current < 420) return;
    lastSurfaceToggleAtRef.current = now;

    const node = videoRef.current || getDocumentVideoNode(playerRootRef.current);
    if (node) {
      const surfaceLabel = surfaceHitRef.current?.getAttribute("aria-label");
      const shouldPause = action ? action === "pause" : surfaceLabel === "暂停" || playingRef.current;
      if (!shouldPause) {
        desiredPlayingRef.current = true;
        void node.play().then(() => {
          playingRef.current = true;
          setPlaying(true);
          startVideoProgressLoop();
        }).catch(() => setPlaying(false));
      } else {
        desiredPlayingRef.current = false;
        playingRef.current = false;
        setPlaying(false);
        try {
          node.pause();
        } catch {
          // Some embedded webviews expose media methods late; keep UI state consistent.
        }
      }
      return;
    }

    togglePlay();
  }, [videoRef, playerRootRef, surfaceHitRef, playingRef, setPlaying, startVideoProgressLoop, togglePlay, desiredPlayingRef]);

  const rememberSurfaceTap = useCallback((x: number, y: number) => {
    surfaceTapStartRef.current = { x, y, at: Date.now() };
  }, []);

  const finishSurfaceTap = useCallback((x: number, y: number) => {
    const start = surfaceTapStartRef.current;
    surfaceTapStartRef.current = null;
    if (!start) return;
    if (Date.now() - start.at > 700) return;
    if (Math.abs(x - start.x) > 14 || Math.abs(y - start.y) > 14) return;
    togglePlayFromSurface();
  }, [togglePlayFromSurface]);

  const handleSurfacePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    rememberSurfaceTap(event.clientX, event.clientY);
  }, [rememberSurfaceTap]);

  const handleSurfacePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    finishSurfaceTap(event.clientX, event.clientY);
  }, [finishSurfaceTap]);

  const handleSurfacePointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    surfaceTapStartRef.current = null;
  }, []);

  const handleSurfaceMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const ownerWindow = event.currentTarget.ownerDocument.defaultView || window;
    if (typeof ownerWindow.PointerEvent !== "undefined") return;
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    rememberSurfaceTap(event.clientX, event.clientY);
  }, [rememberSurfaceTap]);

  const handleSurfaceMouseUp = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const ownerWindow = event.currentTarget.ownerDocument.defaultView || window;
    if (typeof ownerWindow.PointerEvent !== "undefined") return;
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    finishSurfaceTap(event.clientX, event.clientY);
  }, [finishSurfaceTap]);

  const handleSurfaceTouchStart = useCallback((event: ReactTouchEvent<HTMLElement>) => {
    const ownerWindow = event.currentTarget.ownerDocument.defaultView || window;
    if (typeof ownerWindow.PointerEvent !== "undefined") return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    event.stopPropagation();
    rememberSurfaceTap(touch.clientX, touch.clientY);
  }, [rememberSurfaceTap]);

  const handleSurfaceTouchEnd = useCallback((event: ReactTouchEvent<HTMLElement>) => {
    const ownerWindow = event.currentTarget.ownerDocument.defaultView || window;
    if (typeof ownerWindow.PointerEvent !== "undefined") return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    event.stopPropagation();
    finishSurfaceTap(touch.clientX, touch.clientY);
  }, [finishSurfaceTap]);

  const handleSurfaceClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    togglePlayFromSurface(event.currentTarget.getAttribute("aria-label") === "暂停" ? "pause" : "play");
  }, [togglePlayFromSurface]);

  useEffect(() => {
    if (!open) return;
    const node = surfaceHitRef.current;
    if (!node) return;

    const handleNativePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      rememberSurfaceTap(event.clientX, event.clientY);
    };
    const handleNativePointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      finishSurfaceTap(event.clientX, event.clientY);
    };
    const handleNativePointerCancel = (event: PointerEvent) => {
      event.stopPropagation();
      surfaceTapStartRef.current = null;
    };
    const handleNativeMouseDown = (event: MouseEvent) => {
      const ownerWindow = node.ownerDocument.defaultView || window;
      if (typeof ownerWindow.PointerEvent !== "undefined") return;
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      rememberSurfaceTap(event.clientX, event.clientY);
    };
    const handleNativeMouseUp = (event: MouseEvent) => {
      const ownerWindow = node.ownerDocument.defaultView || window;
      if (typeof ownerWindow.PointerEvent !== "undefined") return;
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      finishSurfaceTap(event.clientX, event.clientY);
    };
    const handleNativeTouchStart = (event: TouchEvent) => {
      const ownerWindow = node.ownerDocument.defaultView || window;
      if (typeof ownerWindow.PointerEvent !== "undefined") return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      event.stopPropagation();
      rememberSurfaceTap(touch.clientX, touch.clientY);
    };
    const handleNativeTouchEnd = (event: TouchEvent) => {
      const ownerWindow = node.ownerDocument.defaultView || window;
      if (typeof ownerWindow.PointerEvent !== "undefined") return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      event.stopPropagation();
      finishSurfaceTap(touch.clientX, touch.clientY);
    };
    const handleNativeClick = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      togglePlayFromSurface(node.getAttribute("aria-label") === "暂停" ? "pause" : "play");
    };

    node.addEventListener("pointerdown", handleNativePointerDown);
    node.addEventListener("pointerup", handleNativePointerUp);
    node.addEventListener("pointercancel", handleNativePointerCancel);
    node.addEventListener("mousedown", handleNativeMouseDown);
    node.addEventListener("mouseup", handleNativeMouseUp);
    node.addEventListener("touchstart", handleNativeTouchStart, { passive: false });
    node.addEventListener("touchend", handleNativeTouchEnd, { passive: false });
    node.addEventListener("touchcancel", handleNativeTouchEnd, { passive: false });
    node.addEventListener("click", handleNativeClick);

    return () => {
      node.removeEventListener("pointerdown", handleNativePointerDown);
      node.removeEventListener("pointerup", handleNativePointerUp);
      node.removeEventListener("pointercancel", handleNativePointerCancel);
      node.removeEventListener("mousedown", handleNativeMouseDown);
      node.removeEventListener("mouseup", handleNativeMouseUp);
      node.removeEventListener("touchstart", handleNativeTouchStart);
      node.removeEventListener("touchend", handleNativeTouchEnd);
      node.removeEventListener("touchcancel", handleNativeTouchEnd);
      node.removeEventListener("click", handleNativeClick);
    };
  }, [finishSurfaceTap, open, rememberSurfaceTap, surfaceHitRef, togglePlayFromSurface]);

  const handleWheel = useCallback((event: ReactWheelEvent) => {
    event.preventDefault();
    if (wheelLocked.current) return;

    const normalizedDeltaY = normalizeWheelDelta(event);
    if (normalizedDeltaY === 0) return;

    const previousDelta = wheelAccumulatedDeltaRef.current;
    if (previousDelta !== 0 && Math.sign(previousDelta) !== Math.sign(normalizedDeltaY)) {
      wheelAccumulatedDeltaRef.current = 0;
    }
    wheelAccumulatedDeltaRef.current += normalizedDeltaY;

    if (wheelResetTimerRef.current) {
      window.clearTimeout(wheelResetTimerRef.current);
    }
    wheelResetTimerRef.current = window.setTimeout(() => {
      wheelAccumulatedDeltaRef.current = 0;
      wheelResetTimerRef.current = null;
    }, WHEEL_IDLE_RESET_MS);

    if (Math.abs(wheelAccumulatedDeltaRef.current) < WHEEL_VIDEO_SWITCH_THRESHOLD) return;

    const shouldPlayNext = wheelAccumulatedDeltaRef.current > 0;
    wheelAccumulatedDeltaRef.current = 0;
    wheelLocked.current = true;
    window.setTimeout(() => {
      wheelLocked.current = false;
    }, WHEEL_VIDEO_SWITCH_LOCK_MS);

    if (shouldPlayNext) playNextVideo();
    else playPrevVideo();
  }, [playNextVideo, playPrevVideo]);

  const handleTouchStart = (event: ReactTouchEvent) => {
    touchStart.current = {
      x: event.touches[0]?.clientX || 0,
      y: event.touches[0]?.clientY || 0,
    };
  };

  const handleTouchEnd = (event: ReactTouchEvent) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touchStart.current.x - touch.clientX;
    const deltaY = touchStart.current.y - touch.clientY;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 54) {
      if (deltaX > 0) playNextMedia();
      else playPrevMedia();
      return;
    }

    if (Math.abs(deltaY) > 64) {
      if (deltaY > 0) playNextVideo();
      else playPrevVideo();
    }
  };

  return {
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
    wheelResetTimerRef,
  };
}
