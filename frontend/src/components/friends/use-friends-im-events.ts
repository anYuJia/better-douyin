import { useEffect, useState } from "react";
import { listenEvent } from "@/lib/tauri";
import type { ImConnectionStatus } from "./friends-status-types";
import { numberField, stringField } from "./friends-status-utils";

export function useFriendsImEvents() {
  const [imStatus, setImStatus] = useState<ImConnectionStatus>({
    connected: false,
    message: "接收通道未连接",
    updatedAt: 0,
  });

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenEvent<Record<string, unknown>>("im-status", (payload) => {
      if (disposed || !payload || typeof payload !== "object") return;
      setImStatus({
        connected: Boolean(payload.connected),
        message: stringField(payload, ["message"]) || (payload.connected ? "私信接收已连接" : "私信接收未连接"),
        updatedAt: numberField(payload, ["updated_at", "updatedAt"]) || Date.now(),
      });
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return { imStatus };
}
