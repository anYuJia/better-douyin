import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";

/**
 * 视图缓存后组件常驻挂载，数据视图不再随每次进入而重新加载。
 * 该 hook 在视图从隐藏切回激活时触发一次回调，用于静默刷新可能已过期的数据。
 */
export function useViewActivated(viewId: string, onActivate: () => void) {
  const currentView = useAppStore((s) => s.currentView);
  const wasActiveRef = useRef(useAppStore.getState().currentView === viewId);

  useEffect(() => {
    const isActive = currentView === viewId;
    if (isActive && !wasActiveRef.current) {
      onActivate();
    }
    wasActiveRef.current = isActive;
  }, [currentView, onActivate, viewId]);
}
