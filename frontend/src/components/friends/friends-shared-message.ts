import type {
  JsonRecord,
  LocalChatMessage,
  SharedMessageCard,
} from "./friends-status-types";
import {
  firstUrl,
  isRecord,
  numberField,
  stringField,
} from "./friends-response-map";

export function parseJsonContent(value: string): JsonRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      const nested = JSON.parse(parsed);
      return isRecord(nested) ? nested : null;
    }
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeMessageStatus(value: string): LocalChatMessage["status"] {
  if (value === "pending" || value === "error") return value;
  return "sent";
}

export function normalizeMessageDirection(value: string): LocalChatMessage["direction"] {
  return value === "in" ? "in" : "out";
}

export function inlineImageDataUrl(value: string) {
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  return `data:image/jpeg;base64,${value}`;
}

export function parseNestedJsonField(record: JsonRecord, keys: string[]): JsonRecord | null {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
    if (typeof value !== "string") continue;
    const parsed = parseJsonContent(value);
    if (parsed) return parsed;
  }
  return null;
}

export function normalizeSharedItemId(value: string): string {
  if (!value) return "";
  const match = value.match(/\d+/);
  return match ? match[0] : value;
}

export function uniqueTextParts(parts: string[]) {
  const seen = new Set<string>();
  return parts
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function cardText(value: string, maxLength = 360) {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function imImageResourceUrl(resource: JsonRecord | null) {
  const oid = stringField(resource || undefined, ["oid", "uri", "key"]).trim();
  if (!oid) return "";
  if (/^https?:\/\//i.test(oid)) return oid;
  const normalized = oid.replace(/^\/+/, "");
  return normalized ? `https://p3.douyinpic.com/${normalized}~tplv-x-get:.image` : "";
}

export function imDynamicText(value: unknown): string {
  if (typeof value === "string") return /^https?:\/\//.test(value.trim()) ? "" : value;
  if (Array.isArray(value)) return uniqueTextParts(value.map((item) => imDynamicText(item))).join(" · ");
  if (isRecord(value)) {
    const type = stringField(value, ["type"]);
    if (type === "im-image" || type === "im-icon") return "";
    const content = value.content;
    if (typeof content === "string" && !/^https?:\/\//.test(content.trim())) return content;
    const nested = imDynamicText(content);
    if (nested) return nested;
    const text = stringField(value, ["text"]);
    if (text) return text;
  }
  return "";
}

export function parseDynamicPatchCard(root: JsonRecord): SharedMessageCard | null {
  const directPatch = isRecord(root.im_dynamic_patch)
    ? root.im_dynamic_patch
    : isRecord(root.imDynamicPatch)
      ? root.imDynamicPatch
      : null;
  const patch = directPatch || parseNestedJsonField(root, ["dynamic_patch", "dynamicPatch"]);
  if (!patch) return null;
  const rawData = parseNestedJsonField(patch, ["raw_data", "rawData"]);
  const schema = stringField(root, ["schema"]) || stringField(patch, ["schema"]);
  const cardKey = stringField(patch, ["card_key", "cardKey"]);
  const aweType = numberField(root, ["aweType", "awe_type", "type"]);
  const isVideo = aweType === 11054 || cardKey === "msg_video" || schema.includes("aweme/detail") || schema.includes("note/detail");
  const query = schema.split("?")[1] || "";
  const params = new URLSearchParams(query);
  const itemId = normalizeSharedItemId(
    stringField(root, ["item_id", "itemId"]) ||
      (isRecord(root.aweme_info) ? stringField(root.aweme_info, ["item_id", "itemId"]) : "") ||
      params.get("id") ||
      params.get("aweme_id") ||
      params.get("group_id") ||
      "",
  );
  const rawList = patch.raw_list || patch.rawList;
  const records: JsonRecord[] = [];
  if (Array.isArray(rawList)) {
    rawList.forEach((item) => {
      if (isRecord(item)) records.push(item);
    });
  }
  let title = "";
  let subtitle = "";
  let coverUrl = "";
  let authorName = "";
  let avatarUrl = "";
  if (rawData) {
    title =
      imDynamicText(rawData.top_bottom_top) ||
      imDynamicText(rawData.content_top) ||
      stringField(root, ["description"]).replace(/^\[?分享视频\]?\s*/, "");
    subtitle = imDynamicText(rawData.content_right_top);
    coverUrl = firstUrl(isRecord(rawData.top) ? rawData.top.content : rawData.top);
    avatarUrl = firstUrl(rawData.top_bottom_content_left);
    authorName = imDynamicText(rawData.top_bottom_content_right);
  }
  records.forEach((record) => {
    const text = imDynamicText(record.text);
    if (!text) return;
    const isHeaderLabel = record.color && stringField(record, ["color"]) === "GG";
    if (isHeaderLabel) {
      subtitle = text;
      return;
    }
    const isTitleLabel = record.color && stringField(record, ["color"]) === "E1";
    if (isTitleLabel) {
      title = text;
      return;
    }
    if (!title && text.length > 4 && !text.includes(":") && !text.includes("：")) {
      title = text;
    }
  });
  const attachment = parseNestedJsonField(root, ["attachment"]);
  if (attachment) {
    const attachments = attachment.attachments;
    if (Array.isArray(attachments) && attachments.length > 0) {
      const first = attachments[0];
      if (isRecord(first)) {
        const image = first.image || first.video;
        if (isRecord(image)) {
          const urls = image.url_list || image.urlList;
          if (Array.isArray(urls) && urls.length > 0) {
            coverUrl = String(urls[0] || "");
          }
        }
      }
    }
  }
  if (!title) {
    title =
      stringField(root, ["description"]).replace(/^\[?分享视频\]?\s*/, "") ||
      stringField(root, ["tips"]) ||
      stringField(patch, ["tips"]) ||
      "动态分享";
  }
  return {
    kind: isVideo ? "video" : "share",
    title,
    subtitle: subtitle || (isVideo ? "视频分享" : "动态分享"),
    coverUrl,
    avatarUrl,
    authorName,
    itemId,
  };
}

export function parseSharedMessage(message: LocalChatMessage): SharedMessageCard | null {
  const content = message.rawContent || message.text;
  if (!content) return null;
  const root = parseJsonContent(content);
  if (!root) return null;
  const nestedShare = parseNestedJsonField(root, [
    "card_payload",
    "cardPayload",
    "share_payload",
    "sharePayload",
    "share_info",
    "shareInfo",
    "aweme_info",
    "awemeInfo",
    "aweme",
    "item",
    "share_content",
    "shareContent",
    "content",
    "text",
  ]);
  const rootHasShareSignal = Boolean(
    isRecord(root.video) ||
    isRecord(root.poster) ||
    isRecord(root.resource_url) ||
    isRecord(root.resourceUrl) ||
    root.im_dynamic_patch ||
    root.imDynamicPatch ||
    root.dynamic_patch ||
    root.dynamicPatch ||
    numberField(root, ["aweType", "awe_type", "type"]) ||
    numberField(root, ["awemeType", "aweme_type"]) ||
    stringField(root, ["item_id", "itemId", "id", "gid", "group_id", "aweme_id", "awemeId"]) ||
    firstUrl(root.cover_url) ||
    firstUrl(root.coverUrl) ||
    firstUrl(root.cover_url_v2) ||
    firstUrl(root.coverUrlV2)
  );
  const parsed = rootHasShareSignal ? root : nestedShare || root;
  const nativeVideo = isRecord(parsed.video) ? parsed.video : null;
  const nativePoster = isRecord(parsed.poster) ? parsed.poster : null;
  // Uploaded IM images use transport type 27 and `aweType: 2702`.  That
  // number is not a comment discriminator: the Rust sender writes an
  // encrypted `resource_url` (oid + skey) and `from_gallery: 1` alongside
  // it.  Keep this resource shape separate from genuine comment-share cards
  // so an image returned by automation never turns into “分享评论”.
  const nativeImageResource = isRecord(parsed.resource_url)
    ? parsed.resource_url
    : isRecord(parsed.resourceUrl)
      ? parsed.resourceUrl
      : null;
  const nativeImageResourceId = stringField(nativeImageResource || undefined, ["oid", "uri", "key"]);
  const nativeImageSkey = stringField(nativeImageResource || undefined, ["skey", "secret_key", "secretKey"]);
  const inlineImageUrl = inlineImageDataUrl(stringField(parsed, ["inline_pic", "inlinePic"]));
  const nativeImageUrl = firstUrl(nativeImageResource) || imImageResourceUrl(nativeImageResource);
  const hasNativeUploadedImage = Boolean(
    inlineImageUrl ||
    nativeImageUrl ||
    (nativeImageResourceId && nativeImageSkey) ||
    numberField(parsed, ["from_gallery", "fromGallery"]) > 0,
  );
  // Type-30 native video messages do not carry an aweType or aweme ID.  The
  // playable resource is represented by video.tkey/skey, while the IM server
  // provides a signed poster URL under poster.*_url_list.
  const isNativeVideo = Boolean(
    nativeVideo &&
    nativePoster &&
    (
      stringField(nativeVideo, ["tkey", "skey"]) ||
      stringField(nativePoster, ["oid", "skey"]) ||
      firstUrl(nativePoster)
    ),
  );
  const aweType = numberField(parsed, ["aweType", "awe_type", "type"]);
  // A `awemeType: 68` IM payload is a shared photo/gallery work.  It only
  // transports a cover and `image_count`; the actual images must be fetched
  // by itemId when the card is opened, so do not mistake its mirror URL list
  // for the gallery's individual media items.
  const awemeType = numberField(parsed, ["awemeType", "aweme_type"]);
  const imageCount = Math.max(0, numberField(parsed, ["image_count", "imageCount"]));
  const hasGalleryWorkReference = Boolean(
    stringField(parsed, ["item_id", "itemId", "aweme_id", "awemeId"]) ||
    firstUrl(parsed.cover_url) ||
    firstUrl(parsed.coverUrl) ||
    firstUrl(parsed.cover_url_v2) ||
    firstUrl(parsed.coverUrlV2),
  );
  const isGallery = hasGalleryWorkReference && (awemeType === 68 || imageCount > 1);
  const isVideo = isNativeVideo || aweType === 800 || aweType === 2701 || aweType === 5 || aweType === 8;
  // Empty `ref_msg_info.comment` is present on some native image/video
  // payloads and is metadata, not a shared comment. Only a meaningful root
  // comment field is sufficient to override the image classification.
  const hasCommentPayload = Boolean(
    stringField(parsed, ["comment_id", "commentId", "comment", "comment_content", "commentContent", "comment_text", "commentText"]),
  );
  const isComment =
    !hasNativeUploadedImage &&
    (aweType === 10500 || aweType === 2702 || aweType === 6 || hasCommentPayload);
  const isImage =
    hasNativeUploadedImage ||
    aweType === 501 ||
    aweType === 2704 ||
    aweType === 7 ||
    Boolean(stringField(parsed, ["emoji_type", "emojiType", "image_type", "imageType"])) ||
    numberField(parsed, ["sticker_type", "stickerType"]) > 0;
  const isShare = aweType === 2705 || aweType === 9;
  const isLocation = aweType === 2706 || aweType === 10;
  const isProduct = aweType === 2707 || aweType === 11;
  const isDynamicPatch = aweType === 2708 || aweType === 12 || parsed.im_dynamic_patch || parsed.imDynamicPatch || parsed.dynamic_patch || parsed.dynamicPatch;
  if (isDynamicPatch) {
    return parseDynamicPatchCard(parsed) || (nestedShare ? parseDynamicPatchCard(root) : null);
  }
  if (!isVideo && !isGallery && !isComment && !isImage && !isShare && !isLocation && !isProduct) {
    return null;
  }
  const commentText = stringField(parsed, ["comment", "comment_content", "commentContent", "comment_text", "commentText"]);
  const title = cardText(
    commentText || stringField(parsed, ["title", "content_title", "contentTitle", "aweme_title", "awemeTitle", "desc", "text", "name"]) || "",
  );
  const commentUserName = stringField(parsed, ["comment_user_name", "commentUserName"]);
  const awemeTitle = stringField(parsed, ["aweme_title", "awemeTitle"]);
  const subtitle =
    stringField(parsed, ["sub_title", "subtitle", "hint", "anchor_name"]) ||
    [
      isComment ? "分享评论" : "",
      commentUserName ? `评论者：${commentUserName}` : "",
      awemeTitle ? `作品：${awemeTitle}` : "",
    ].filter(Boolean).join(" · ");
  const coverUrl =
    firstUrl(nativePoster) ||
    firstUrl(parsed.cover_url) ||
    firstUrl(parsed.coverUrl) ||
    firstUrl(parsed.cover_url_v2) ||
    firstUrl(parsed.coverUrlV2) ||
    firstUrl(parsed.url) ||
    nativeImageUrl ||
    stringField(parsed, ["cover_url", "coverUrl", "image_url", "imageUrl"]) ||
    inlineImageUrl ||
    "";
  const skey =
    stringField(parsed, ["skey"]) ||
    stringField(nativePoster || undefined, ["skey"]) ||
    nativeImageSkey ||
    undefined;
  const avatarUrl =
    firstUrl(parsed.content_thumb) ||
    firstUrl(parsed.contentThumb) ||
    stringField(parsed, ["avatar_url", "avatarUrl", "author_avatar", "authorAvatar"]) ||
    "";
  const authorName = stringField(parsed, ["author_name", "authorName", "nickname"]) || "";
  const itemId = normalizeSharedItemId(
    stringField(parsed, ["item_id", "itemId", "id", "gid", "group_id", "aweme_id", "awemeId"]) || "",
  );
  let kind: SharedMessageCard["kind"] = "share";
  if (isVideo) kind = "video";
  else if (isGallery) kind = "gallery";
  else if (isComment) kind = "comment";
  else if (isImage) kind = "image";
  else if (isLocation) kind = "location";
  else if (isProduct) kind = "product";
  return {
    kind,
    title: title || (isNativeVideo ? "视频" : kind === "gallery" ? "图集" : ""),
    subtitle: subtitle || (
      isNativeVideo
        ? "视频消息"
        : kind === "video"
          ? "视频分享"
          : kind === "gallery"
            ? imageCount > 1 ? `${imageCount} 张图集` : "图集作品"
            : kind === "image"
              ? "图片分享"
              : "分享"
    ),
    coverUrl,
    skey,
    avatarUrl,
    authorName: cardText(authorName || stringField(parsed, ["content_name", "contentName"]), 96),
    itemId,
    mediaCount: isGallery ? Math.max(imageCount, 1) : undefined,
  };
}
