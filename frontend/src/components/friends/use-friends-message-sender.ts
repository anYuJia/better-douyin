import { useCallback, useRef, useEffect } from "react";
import { listenEvent, sendFriendImageMessage, sendFriendMessage, sendFriendVideoMessage } from "@/lib/tauri";
import { createVideoPosterDataUrl } from "@/lib/video-poster";
import {
  MAX_SEND_IMAGE_BYTES,
  type ChatMessages,
  type FriendStatusItem,
  type LocalChatMessage,
} from "./friends-status-types";
import {
  imageMessageRawContent,
  persistChatMessages,
  readFileAsDataUrl,
  readImageSize,
} from "./friends-status-utils";

const VIDEO_SEND_SPACING_MS = 1200;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

interface SenderProps {
  currentSecUid: string;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessages>>;
  updateDraft: (secUid: string, value: string) => void;
  setError: (msg: string) => void;
}

export function useFriendsMessageSender({
  currentSecUid,
  setChatMessages,
  updateDraft,
  setError,
}: SenderProps) {
  const currentSecUidRef = useRef(currentSecUid);
  const videoSendQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    currentSecUidRef.current = currentSecUid;
  }, [currentSecUid]);

  const patchMessage = useCallback((secUid: string, messageId: string, patch: Partial<LocalChatMessage>) => {
    setChatMessages((current) => {
      const next = {
        ...current,
        [secUid]: (current[secUid] || []).map((message) =>
          message.id === messageId ? { ...message, ...patch } : message,
        ),
      };
      persistChatMessages(next, currentSecUidRef.current);
      return next;
    });
  }, [setChatMessages]);

  const sendLocalMessage = useCallback(async (friend: FriendStatusItem, value: string) => {
    const text = value.trim();
    if (!text) return;
    const message: LocalChatMessage = {
      id: `${friend.secUid}-${Date.now()}`,
      text,
      rawContent: undefined,
      createdAt: Date.now(),
      status: "pending",
      direction: "out",
    };
    setChatMessages((current) => {
      const next = {
        ...current,
        [friend.secUid]: [...(current[friend.secUid] || []), message],
      };
      persistChatMessages(next, currentSecUidRef.current);
      return next;
    });
    updateDraft(friend.secUid, "");

    if (!friend.uid) {
      patchMessage(friend.secUid, message.id, {
        status: "error",
        error: "缺少好友数字 uid，无法发送",
      });
      return;
    }

    try {
      const result = await sendFriendMessage({ toUserId: friend.uid, content: text });
      if (!result.success) {
        throw new Error(result.message || "发送失败");
      }
      patchMessage(friend.secUid, message.id, { status: "sent", error: "" });
    } catch (caught) {
      patchMessage(friend.secUid, message.id, {
        status: "error",
        error: caught instanceof Error ? caught.message : "发送失败",
      });
    }
  }, [patchMessage, updateDraft, setChatMessages]);

  const sendLocalImageMessage = useCallback(async (friend: FriendStatusItem, file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }
    if (file.size > MAX_SEND_IMAGE_BYTES) {
      setError("图片不能超过 8MB");
      return;
    }
    if (!friend.uid) {
      setError("缺少好友数字 uid，无法发送图片");
      return;
    }
    setError("");
    const imageDataUrl = await readFileAsDataUrl(file);
    if (!imageDataUrl) {
      setError("读取图片失败");
      return;
    }
    const size = await readImageSize(imageDataUrl);
    const message: LocalChatMessage = {
      id: `${friend.secUid}-${Date.now()}`,
      text: "[图片]",
      rawContent: imageMessageRawContent(imageDataUrl, size.width, size.height, file.name),
      imagePreviewUrl: URL.createObjectURL(file),
      createdAt: Date.now(),
      status: "pending",
      direction: "out",
    };
    setChatMessages((current) => {
      const next = {
        ...current,
        [friend.secUid]: [...(current[friend.secUid] || []), message],
      };
      persistChatMessages(next, currentSecUidRef.current);
      return next;
    });

    try {
      const result = await sendFriendImageMessage({
        toUserId: friend.uid,
        imageDataUrl,
        width: size.width,
        height: size.height,
        fileName: file.name,
        mimeType: file.type,
      });
      if (!result.success) {
        throw new Error(result.message || "发送图片失败");
      }
      patchMessage(friend.secUid, message.id, { status: "sent", error: "" });
    } catch (caught) {
      patchMessage(friend.secUid, message.id, {
        status: "error",
        error: caught instanceof Error ? caught.message : "发送图片失败",
      });
    }
  }, [patchMessage, setError, setChatMessages]);

  const sendLocalVideoMessage = useCallback(async (friend: FriendStatusItem, file: File) => {
    if (!file.type.startsWith("video/")) return setError("请选择视频文件");
    if (file.size > 20 * 1024 * 1024) return setError("视频不能超过 20MB");
    if (!friend.uid) return setError("缺少好友数字 uid，无法发送视频");
    setError("");
    const message: LocalChatMessage = {
      id: `${friend.secUid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: "[视频]",
      videoPreviewUrl: URL.createObjectURL(file),
      createdAt: Date.now(),
      status: "pending",
      direction: "out",
      videoUploadProgress: 0,
      videoUploadStage: "正在准备视频",
    };
    setChatMessages((current) => {
      const next = { ...current, [friend.secUid]: [...(current[friend.secUid] || []), message] };
      persistChatMessages(next, currentSecUidRef.current);
      return next;
    });

    const runSend = async () => {
      try {
        patchMessage(friend.secUid, message.id, { videoUploadProgress: 1, videoUploadStage: "正在读取视频" });
        const videoDataUrl = await readFileAsDataUrl(file);
        if (!videoDataUrl) throw new Error("读取视频失败");
        patchMessage(friend.secUid, message.id, { videoUploadProgress: 3, videoUploadStage: "正在生成视频封面" });
        const coverDataUrl = await createVideoPosterDataUrl(file);
        if (!coverDataUrl) throw new Error("生成视频封面失败");
        patchMessage(friend.secUid, message.id, {
          videoPosterUrl: coverDataUrl,
          videoUploadProgress: 4,
          videoUploadStage: "即将上传视频",
        });

        let unlisten: (() => void) | undefined;
        try {
          unlisten = await listenEvent<Record<string, unknown>>("im-video-upload-progress", (payload) => {
            const requestId = String(payload.request_id || payload.upload_request_id || "").trim();
            if (requestId !== message.id) return;
            const progress = Number(payload.progress);
            const stage = String(payload.message || payload.phase || "正在上传视频").trim();
            patchMessage(friend.secUid, message.id, {
              videoUploadProgress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : undefined,
              videoUploadStage: stage,
            });
          });
        } catch {
          // Progress is an enhancement. Sending the video must still work when
          // an older runtime does not expose this event yet.
        }

        try {
          const result = await sendFriendVideoMessage({
            toUserId: friend.uid,
            videoDataUrl,
            coverDataUrl,
            fileName: file.name,
            mimeType: file.type,
            uploadRequestId: message.id,
          });
          if (!result.success) throw new Error(result.message || "发送视频失败");
          patchMessage(friend.secUid, message.id, {
            status: "sent",
            error: "",
            videoUploadProgress: 100,
            videoUploadStage: "视频已发送，点击播放",
          });
          await sleep(VIDEO_SEND_SPACING_MS);
        } finally {
          unlisten?.();
        }
      } catch (caught) {
        patchMessage(friend.secUid, message.id, {
          status: "error",
          error: caught instanceof Error ? caught.message : "发送视频失败",
          videoUploadStage: "视频发送失败",
        });
      }
    };
    const queued = videoSendQueueRef.current.catch(() => undefined).then(runSend);
    videoSendQueueRef.current = queued.catch(() => undefined);
    await queued;
  }, [patchMessage, setError, setChatMessages]);

  return {
    sendLocalMessage,
    sendLocalImageMessage,
    sendLocalVideoMessage,
    patchMessage,
  };
}
