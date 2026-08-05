import {
  LIKE_NOTICE_PATTERN,
  type LocalChatMessage,
} from "./friends-status-types";
import {
  numberField,
  firstUrl,
} from "./friends-response-map";
import {
  parseJsonContent,
  parseSharedMessage,
} from "./friends-shared-message";
export {
  inlineImageDataUrl,
  normalizeMessageDirection,
  normalizeMessageStatus,
  parseJsonContent,
} from "./friends-shared-message";

export function imageMessageRawContent(imageDataUrl: string, width = 0, height = 0, fileName = "") {
  return JSON.stringify({
    aweType: 2704,
    type: 7,
    inline_pic: imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, ""),
    width,
    height,
    file_name: fileName,
  });
}

export function fallbackMessageText(rawContent: string | undefined) {
  if (!rawContent) return "[未知类型消息]";
  const parsed = parseJsonContent(rawContent);
  if (!parsed) return "[未知类型消息]";
  const aweType = numberField(parsed, ["aweType", "awe_type", "type"]);
  const awemeType = numberField(parsed, ["awemeType", "aweme_type"]);
  const imageCount = numberField(parsed, ["image_count", "imageCount"]);
  if (awemeType === 68 || imageCount > 1) return "[图集分享]";
  if (aweType === 800 || aweType === 2701 || aweType === 5 || aweType === 8) return "[视频分享]";
  if (aweType === 2702 || aweType === 6) return "[评论分享]";
  if (aweType === 2704 || aweType === 7) return "[图片分享]";
  if (aweType === 2705 || aweType === 9) return "[分享卡片]";
  if (aweType === 2706 || aweType === 10) return "[位置定位]";
  if (aweType === 2707 || aweType === 11) return "[商品卡片]";
  return "[卡片消息]";
}

export function normalizeLikeNoticeText(value: string) {
  if (!value) return "";
  return LIKE_NOTICE_PATTERN.test(value) ? "系统提示：对方点赞了你的作品" : value;
}

export function messagePreviewText(message: LocalChatMessage | undefined) {
  if (!message) return "";
  if (message.imagePreviewUrl) return "[图片]";
  if (message.videoPreviewUrl) return "[视频]";
  const shared = parseSharedMessage(message);
  if (shared) {
    return shared.kind === "video"
      ? "[视频分享]"
      : shared.kind === "gallery"
        ? `[图集${shared.mediaCount && shared.mediaCount > 1 ? ` × ${shared.mediaCount}` : ""}]`
        : shared.kind === "image"
          ? "[图片分享]"
          : "[分享卡片]";
  }
  return normalizeLikeNoticeText(message.text);
}

export function latestChatMessage(messages: LocalChatMessage[] | undefined) {
  if (!messages || messages.length === 0) return undefined;
  return messages.reduce<LocalChatMessage | undefined>((latest, message) => {
    if (!latest || message.createdAt > latest.createdAt) return message;
    return latest;
  }, undefined);
}

export function normalizeImUrl(value: string) {
  if (!value) return "";
  return value.replace(/^http:/, "https:");
}

export function unsignedMediaUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.searchParams.delete("x-expires");
    url.searchParams.delete("x-signature");
    return url.toString();
  } catch {
    return value;
  }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

export function readImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

export function deepStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return "";
}

export function deepFirstUrl(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = firstUrl(record[key]);
    if (value) return value;
  }
  return "";
}

export function hasDeepField(record: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => record[key] !== undefined);
}
