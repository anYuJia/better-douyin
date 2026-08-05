import {
  LIKE_NOTICE_PATTERN,
  type LocalChatMessage,
  type JsonRecord,
  type ChatMessages,
} from "./friends-status-types";
import {
  isRecord,
  stringField,
  numberField,
  firstUrl,
} from "./friends-response-map";
import {
  normalizeMessageDirection,
  normalizeMessageStatus,
  inlineImageDataUrl,
  imImageResourceUrl,
  parseJsonContent,
  parseSharedMessage,
} from "./friends-shared-message";
export {
  imDynamicText,
  normalizeSharedItemId,
  parseDynamicPatchCard,
  parseNestedJsonField,
  parseSharedMessage,
  uniqueTextParts,
} from "./friends-shared-message";

export function normalizeStoredChatMessage(secUid: string, message: JsonRecord): LocalChatMessage {
  const item: LocalChatMessage = {
    id: stringField(message, ["id"]) || `${secUid}-${numberField(message, ["createdAt"])}-${Math.random()}`,
    text: stringField(message, ["text"]),
    rawContent: stringField(message, ["rawContent", "raw_content"]) || undefined,
    imagePreviewUrl: stringField(message, ["imagePreviewUrl"]).startsWith("blob:") ? undefined : stringField(message, ["imagePreviewUrl"]) || undefined,
    createdAt: numberField(message, ["createdAt"]),
    status: normalizeMessageStatus(stringField(message, ["status"])),
    direction: normalizeMessageDirection(stringField(message, ["direction"])),
    senderUid: stringField(message, ["senderUid", "sender_uid"]),
    error: stringField(message, ["error"]) || undefined,
  };
  if (isLocalUnsentImagePlaceholder(item)) {
    return {
      ...item,
      status: "error",
      error: item.error || "图片未发送：缺少抖音上传凭证",
    };
  }
  return item;
}

export function isLocalUnsentImagePlaceholder(message: LocalChatMessage) {
  if (message.direction !== "out" || message.status === "error") return false;
  if (message.imagePreviewUrl) return false;
  const parsed = parseJsonContent(message.rawContent || "");
  if (!parsed || Number(parsed.aweType || 0) !== 2702) return false;
  const resource = isRecord(parsed.resource_url)
    ? parsed.resource_url
    : isRecord(parsed.resourceUrl)
      ? parsed.resourceUrl
      : null;
  const resourceId = stringField(resource || undefined, ["oid", "uri", "key"]);
  const resourceSkey =
    stringField(resource || undefined, ["skey", "secret_key", "secretKey"]) ||
    stringField(parsed, ["skey"]);
  const inlinePic = stringField(parsed, ["inline_pic", "inlinePic"]);
  const hasInlineImage = Boolean(inlineImageDataUrl(inlinePic));
  const hasUploadedResource = Boolean(
    firstUrl(resource) ||
    imImageResourceUrl(resource) ||
    firstUrl(parsed.url) ||
    (resourceId && resourceSkey),
  );
  return !hasInlineImage && !hasUploadedResource;
}

export function sanitizePersistedChatMessage(message: LocalChatMessage, rawLimit = 30000): LocalChatMessage {
  return {
    id: message.id,
    text: message.text,
    rawContent: compactRawContent(message.rawContent, rawLimit),
    imagePreviewUrl: message.imagePreviewUrl?.startsWith("blob:") ? undefined : message.imagePreviewUrl,
    // Blob URLs only exist in the current renderer session.  Persisting them
    // would make a reload show a broken player, so native-video previews are
    // intentionally excluded from local storage.
    videoPreviewUrl: undefined,
    videoPosterUrl: undefined,
    createdAt: message.createdAt,
    status: message.status === "pending" ? "error" : message.status,
    direction: message.direction,
    senderUid: message.senderUid,
    error: message.status === "pending" ? "发送未完成，请重试" : message.error ? message.error.slice(0, 300) : undefined,
  };
}

export function compactRawContent(rawContent: string | undefined, maxLength = 30000) {
  if (!rawContent) return undefined;
  if (rawContent.length <= maxLength) return rawContent;
  return undefined;
}

export function compactChatMessagesForStorage(
  messages: ChatMessages,
  perFriendLimit = 40,
  rawLimit = 30000,
): ChatMessages {
  const compacted: ChatMessages = {};
  for (const [secUid, items] of Object.entries(messages)) {
    const kept = [...items]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-perFriendLimit)
      .map((message) => sanitizePersistedChatMessage(message, rawLimit));
    if (kept.length > 0) compacted[secUid] = kept;
  }
  return compacted;
}

export function centerNoticeText(message: LocalChatMessage) {
  if (message.direction === "in" && LIKE_NOTICE_PATTERN.test(message.text)) {
    return "对方点赞了你的作品";
  }
  if (message.text.includes("已成为好友") || message.text.includes("开始聊天吧")) {
    return message.text;
  }
  return null;
}

export function hasFramedMessageBody(message: LocalChatMessage) {
  if (message.imagePreviewUrl || message.videoPreviewUrl) return true;
  const shared = parseSharedMessage(message);
  return Boolean(shared);
}
