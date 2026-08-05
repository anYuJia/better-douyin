import {
  mediaProxyUrl,
  parseLink,
  sendFriendImageMessage,
  sendFriendVideoMessage,
  type AiInteractionConfig,
} from "@/lib/tauri";
import { createVideoPosterDataUrl } from "@/lib/video-poster";

const SHARE_URL = /https?:\/\/[^\s<>"，。！？；、]+|www\.[^\s<>"，。！？；、]+/i;
const VIDEO_SEND_SPACING_MS = 1200;
const AUTO_RETURN_MAX_RETRIES = 3;
const AUTO_RETURN_RETRY_BASE_DELAY_MS = 900;

export type AutoReturnSharedMediaResult = {
  handled: boolean;
  sent: number;
  skipped: string;
  sharedWorkKey?: string;
  /** Opaque IDs returned by the IM send endpoint, used to silence our own live echo. */
  sentMessageKeys?: string[];
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

class AutoReturnCancelledError extends Error {
  constructor() {
    super("auto_return_cancelled");
  }
}

type AutoReturnRetryOptions = {
  shouldContinue: () => boolean;
  onRetry?: (message: string) => void;
};

function autoReturnErrorMessage(error: unknown) {
  if (error instanceof Error) return String(error.message || "").trim() || error.name || "未知错误";
  return String(error || "").trim() || "未知错误";
}

function isAutoReturnCancelledError(error: unknown) {
  return error instanceof AutoReturnCancelledError;
}

function isRetryableAutoReturnError(error: unknown) {
  const reason = autoReturnErrorMessage(error);
  return /error decoding response body|response body|timeout|timed out|request timed out|network|fetch|failed to fetch|connection reset|socket hang up|econnreset|etimedout|econnaborted|502|503|504|429|temporarily|temporary|临时|网络波动|请求超时|连接.*重置|接口返回格式异常|响应解析失败/i.test(reason);
}

function describeAutoReturnRetryReason(error: unknown) {
  const reason = autoReturnErrorMessage(error);
  if (/error decoding response body|response body|响应解析失败|接口返回格式异常/i.test(reason)) {
    return "平台响应解析失败，正在自动重试";
  }
  if (/timeout|timed out|request timed out|etimedout|请求超时/i.test(reason)) {
    return "请求超时，正在自动重试";
  }
  if (/network|fetch|failed to fetch|connection reset|socket hang up|econnreset|econnaborted|网络波动|连接.*重置/i.test(reason)) {
    return "网络波动，正在自动重试";
  }
  if (/502|503|504|429|temporarily|temporary|临时/i.test(reason)) {
    return "平台服务临时异常，正在自动重试";
  }
  return `${reason}，正在自动重试`;
}

function autoReturnRetryDelayMs(retryCount: number) {
  return Math.min(5000, AUTO_RETURN_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1));
}

async function withAutoReturnRetry<T>(failureLabel: string, action: () => Promise<T>, options: AutoReturnRetryOptions): Promise<T> {
  let retries = 0;
  while (true) {
    if (!options.shouldContinue()) throw new AutoReturnCancelledError();
    try {
      return await action();
    } catch (error) {
      if (!options.shouldContinue()) throw new AutoReturnCancelledError();
      const message = autoReturnErrorMessage(error);
      const retryable = isRetryableAutoReturnError(error);
      if (!retryable || retries >= AUTO_RETURN_MAX_RETRIES) {
        if (retryable && retries >= AUTO_RETURN_MAX_RETRIES) {
          throw new Error(`${failureLabel}: 已重试 ${AUTO_RETURN_MAX_RETRIES} 次后仍失败，${message}`);
        }
        if (error instanceof Error) throw error;
        throw new Error(message || failureLabel);
      }
      retries += 1;
      options.onRetry?.(`好友分享内容回传重试：${failureLabel} · 第 ${retries}/${AUTO_RETURN_MAX_RETRIES} 次 · ${describeAutoReturnRetryReason(error)}`);
      await sleep(autoReturnRetryDelayMs(retries));
    }
  }
}

function imageDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("读取下载的图片失败"));
    reader.readAsDataURL(blob);
  });
}

function sharedCardItemId(value: string) {
  try {
    const root = JSON.parse(value) as unknown;
    const visit = (item: unknown, depth = 0): string => {
      if (!item || depth > 4) return "";
      if (typeof item === "string") {
        const text = item.trim();
        if (!text || !/^[{[]/.test(text)) return "";
        try {
          return visit(JSON.parse(text), depth + 1);
        } catch {
          return "";
        }
      }
      if (typeof item !== "object") return "";
      if (Array.isArray(item)) {
        for (const child of item) {
          const found = visit(child, depth + 1);
          if (found) return found;
        }
        return "";
      }
      const record = item as Record<string, unknown>;
      for (const key of ["itemId", "item_id", "aweme_id", "awemeId", "share_id"]) {
        const candidate = String(record[key] || "").trim();
        if (/^\d{10,}$/.test(candidate)) return candidate;
      }
      for (const child of Object.values(record)) {
        const found = visit(child, depth + 1);
        if (found) return found;
      }
      return "";
    };
    return visit(root);
  } catch {
    return "";
  }
}

function sharedUrl(value: string) {
  const direct = value.match(SHARE_URL)?.[0].replace(/[，。！？；、,.!;]+$/, "");
  if (direct && /(?:^https?:\/\/)?(?:[^/]+\.)?douyin\.com\//i.test(direct)) return direct;
  const itemId = sharedCardItemId(value);
  return itemId ? `https://www.douyin.com/video/${itemId}` : "";
}

export function isSharedWorkPayload(value: string) {
  const normalized = String(value || "").trim();
  if (normalized === "[分享作品]" || normalized === "[图集]") return true;
  return Boolean(sharedUrl(value));
}

export function isResolvableSharedWorkPayload(value: string) {
  return Boolean(sharedUrl(value));
}

function sharedUrlItemId(url: string) {
  const normalized = String(url || "").trim();
  if (!normalized) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`);
    const pathId = parsed.pathname.match(/\/(?:video|note)\/(\d{10,})/i)?.[1] || "";
    if (pathId) return pathId;
    for (const key of ["aweme_id", "item_id", "modal_id", "group_id", "id"]) {
      const candidate = String(parsed.searchParams.get(key) || "").trim();
      if (/^\d{10,}$/.test(candidate)) return candidate;
    }
  } catch {
    // A malformed URL can still be used as a normalized direct-link key below.
  }
  return "";
}

export function sharedWorkReturnKey(value: string) {
  const itemId = sharedCardItemId(value);
  if (itemId) return `aweme:${itemId}`;
  const link = sharedUrl(value);
  const linkItemId = sharedUrlItemId(link);
  if (linkItemId) return `aweme:${linkItemId}`;
  return link ? `url:${link.toLowerCase()}` : "";
}

type ParsedSharedVideo = NonNullable<Awaited<ReturnType<typeof parseLink>>["video"]>;

type ReturnMediaItem = {
  type: "image" | "video";
  url: string;
  fallbackUrls: string[];
};

function normalizeReturnMediaType(value: unknown): ReturnMediaItem["type"] | null {
  const type = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  if (type === "image" || type === "images" || type === "photo") return "image";
  // A live photo is uploaded as an IM video.  Its optional still-image part
  // is intentionally not duplicated in the logical return media sequence.
  if (type === "video" || type === "live_photo" || type === "livephoto" || type === "live") return "video";
  return null;
}

function cleanReturnMediaItem(type: unknown, url: unknown, fallbackUrls: unknown): ReturnMediaItem | null {
  const normalizedType = normalizeReturnMediaType(type);
  const primaryUrl = String(url || "").trim();
  if (!normalizedType || !primaryUrl) return null;
  const seen = new Set<string>([primaryUrl]);
  const candidates = Array.isArray(fallbackUrls) ? fallbackUrls : [];
  const cleanedFallbackUrls = candidates.flatMap((candidate) => {
    const text = String(candidate || "").trim();
    if (!text || seen.has(text)) return [];
    seen.add(text);
    return [text];
  });
  return { type: normalizedType, url: primaryUrl, fallbackUrls: cleanedFallbackUrls };
}

/**
 * Prefer the backend-provided logical source-media sequence.  Its order maps
 * one-to-one to the original gallery slots, unlike legacy image/live-photo
 * fields that intentionally expand a Live Photo into a still image plus video
 * for downloader workflows.
 */
function collectReturnMediaItems(video: ParsedSharedVideo): ReturnMediaItem[] {
  const hasExplicitReturnMedia = Array.isArray(video.return_media_urls);
  const typedItems = (video.return_media_urls || [])
    .map((item) => cleanReturnMediaItem(item.type, item.url, item.fallback_urls))
    .filter(Boolean) as ReturnMediaItem[];
  // An explicit empty list means the backend inspected the source slots and
  // found no safely downloadable media. Do not fall back to their posters.
  if (hasExplicitReturnMedia) return typedItems;

  // Compatibility for older Rust/Python backends that do not yet expose
  // `return_media_urls`. Keep their historical image-album behavior rather
  // than turning one legacy Live Photo into duplicate image/video messages.
  const imageUrls = (video.image_urls || video.images || [])
    .map((url) => String(url || "").trim())
    .filter(Boolean);
  if (imageUrls.length > 0) {
    return imageUrls.map((url) => ({ type: "image" as const, url, fallbackUrls: [] }));
  }

  const livePhotoUrls = (video.live_photo_urls || video.live_photos || [])
    .map((url) => String(url || "").trim())
    .filter(Boolean);
  if (livePhotoUrls.length > 0) {
    return livePhotoUrls.map((url) => ({ type: "video" as const, url, fallbackUrls: [] }));
  }

  const videoUrl = String(video.video?.play_addr || video.video?.download_addr || "").trim();
  return videoUrl ? [{ type: "video", url: videoUrl, fallbackUrls: [] }] : [];
}

/**
 * Return a shared work to its sender. Image albums are downloaded through the
 * local media proxy, uploaded to IM one by one, then released from memory.
 * Videos follow the same download → binary upload → release flow; no work card
 * is sent back to the friend.
 */
export async function autoReturnSharedMedia(
  senderUid: string,
  incomingText: string,
  config: AiInteractionConfig,
  options: {
    shouldContinue?: () => boolean;
    shouldHandleSharedWorkKey?: (sharedWorkKey: string) => boolean;
    onRetry?: (message: string) => void;
  } = {},
): Promise<AutoReturnSharedMediaResult> {
  const shouldContinue = options.shouldContinue || (() => true);
  const cancelled = () => ({ handled: true, sent: 0, skipped: "account_changed" });
  if (!shouldContinue()) return cancelled();
  if (!config.auto_return_shared_media || !senderUid) return { handled: false, sent: 0, skipped: "disabled" };
  const link = sharedUrl(incomingText);
  if (!link) return { handled: false, sent: 0, skipped: "no_link" };
  const parsed = await parseLink(link);
  if (!shouldContinue()) return cancelled();
  const video = parsed.video;
  if (!parsed.success || !video) throw new Error(parsed.message || "解析分享链接失败");
  const sharedWorkKey = video.aweme_id ? `aweme:${video.aweme_id}` : sharedWorkReturnKey(incomingText);
  if (sharedWorkKey && options.shouldHandleSharedWorkKey && !options.shouldHandleSharedWorkKey(sharedWorkKey)) {
    return { handled: true, sent: 0, skipped: "duplicate", sharedWorkKey };
  }
  const maxBytes = Math.max(1, Number(config.auto_return_shared_max_size_mb || 20)) * 1024 * 1024;
  const maxMedia = Math.max(1, Number(config.auto_return_shared_max_media_count || 9));
  const sourceMediaItems = collectReturnMediaItems(video);
  if (sourceMediaItems.length === 0) return { handled: true, sent: 0, skipped: "no_media", sharedWorkKey };

  const skippedImages = sourceMediaItems.filter((item) => item.type === "image" && !config.auto_return_shared_allow_images).length;
  const skippedVideos = sourceMediaItems.filter((item) => item.type === "video" && !config.auto_return_shared_allow_videos).length;
  // Apply the media-count cap after per-type permission filtering. Disabled
  // images must not consume a slot that could otherwise return a later video.
  const mediaItems = sourceMediaItems
    .filter((item) => (item.type === "image" ? config.auto_return_shared_allow_images : config.auto_return_shared_allow_videos))
    .slice(0, maxMedia);
  if (mediaItems.length === 0) {
    if (skippedImages > 0 && skippedVideos === 0) return { handled: true, sent: 0, skipped: "images_disabled", sharedWorkKey };
    if (skippedVideos > 0 && skippedImages === 0) return { handled: true, sent: 0, skipped: "videos_disabled", sharedWorkKey };
    return { handled: true, sent: 0, skipped: "media_disabled", sharedWorkKey };
  }

  let sent = 0;
  let skippedBySize = 0;
  const sentMessageKeys: string[] = [];
  const retryContext: AutoReturnRetryOptions = { shouldContinue, onRetry: options.onRetry };

  const rememberSentMessage = (result: { client_message_id?: unknown; message_id?: unknown }) => {
    const clientMessageId = String(result.client_message_id || "").trim();
    if (clientMessageId) sentMessageKeys.push(`client:${clientMessageId}`);
    const messageId = String(result.message_id || "").trim();
    if (messageId && messageId !== "0") sentMessageKeys.push(`server:${messageId}`);
  };

  try {
    for (let index = 0; index < mediaItems.length; index += 1) {
      const item = mediaItems[index];
      if (!shouldContinue()) return cancelled();

      const mediaLabel = item.type === "image" ? "图片" : "视频";
      let response: Response | null = null;
      let lastDownloadError = "";
      for (const candidateUrl of [item.url, ...item.fallbackUrls]) {
        if (!shouldContinue()) return cancelled();
        try {
          response = await withAutoReturnRetry(
            `下载第 ${index + 1} 个${mediaLabel}失败`,
            async () => {
              const candidateResponse = await fetch(mediaProxyUrl(candidateUrl, item.type));
              if (!candidateResponse.ok) throw new Error(`HTTP ${candidateResponse.status}`);
              return candidateResponse;
            },
            retryContext,
          );
          break;
        } catch (error) {
          if (isAutoReturnCancelledError(error)) throw error;
          lastDownloadError = autoReturnErrorMessage(error);
        }
      }
      if (!shouldContinue()) return cancelled();
      if (!response) {
        throw new Error(`下载第 ${index + 1} 个${mediaLabel}失败${lastDownloadError ? `: ${lastDownloadError}` : ""}`);
      }

      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > maxBytes) {
        skippedBySize += 1;
        continue;
      }
      const blob = await response.blob();
      if (!shouldContinue()) return cancelled();
      if (!blob.size || blob.size > maxBytes) {
        skippedBySize += 1;
        continue;
      }
      const dataUrl = await imageDataUrl(blob);
      if (!shouldContinue()) return cancelled();

      if (item.type === "image") {
        const failureLabel = `发送第 ${index + 1} 张图片失败`;
        const result = await withAutoReturnRetry(
          failureLabel,
          async () => {
            const sendResult = await sendFriendImageMessage({
              toUserId: senderUid,
              imageDataUrl: dataUrl,
              fileName: `${video.aweme_id || "shared"}-${index + 1}.${blob.type.includes("png") ? "png" : "jpg"}`,
              mimeType: blob.type || "image/jpeg",
            });
            if (!sendResult.success) throw new Error(sendResult.message || failureLabel);
            return sendResult;
          },
          retryContext,
        );
        rememberSentMessage(result);
      } else {
        const coverDataUrl = await createVideoPosterDataUrl(blob);
        if (!shouldContinue()) return cancelled();
        const failureLabel = `发送第 ${index + 1} 个视频失败`;
        const result = await withAutoReturnRetry(
          failureLabel,
          async () => {
            const sendResult = await sendFriendVideoMessage({
              toUserId: senderUid,
              videoDataUrl: dataUrl,
              coverDataUrl,
              fileName: `${video.aweme_id || "shared"}-${index + 1}.mp4`,
              mimeType: blob.type || "video/mp4",
            });
            if (!sendResult.success) throw new Error(sendResult.message || failureLabel);
            return sendResult;
          },
          retryContext,
        );
        rememberSentMessage(result);
        if (index < mediaItems.length - 1) {
          await sleep(VIDEO_SEND_SPACING_MS);
          if (!shouldContinue()) return cancelled();
        }
      }
      sent += 1;
    }
  } catch (error) {
    if (isAutoReturnCancelledError(error)) return cancelled();
    throw error;
  }

  if (sent > 0) return { handled: true, sent, skipped: "", sharedWorkKey, sentMessageKeys };
  if (skippedBySize > 0) return { handled: true, sent, skipped: "size_limit", sharedWorkKey };
  return { handled: true, sent, skipped: "no_media", sharedWorkKey };
}
