import {
  CHAT_SESSIONS_KEY,
  type ChatSession,
  type ChatSessions,
  type LocalChatMessage,
} from "./friends-status-types";
import { getNamespacedKey } from "./friends-storage";
import { isRecord, numberField, stringField } from "./friends-response-map";
import { readJson, writeJson } from "@/lib/storage";

const RECENT_MESSAGE_COUNT = 8;
const SUMMARY_LIMIT = 900;
const CONTEXT_LIMIT = 2_200;

function compact(value: string, limit = SUMMARY_LIMIT) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const head = Math.min(160, Math.floor(limit * 0.22));
  return `${text.slice(0, head)} … ${text.slice(-(limit - head - 3))}`;
}

function line(message: LocalChatMessage, displayName: string) {
  const text = compact(message.text || message.rawContent || "", 120);
  return text ? `${message.direction === "in" ? displayName : "我"}：${text}` : "";
}

export function readChatSessions(currentSecUid?: string): ChatSessions {
  const parsed = readJson<unknown>(getNamespacedKey(CHAT_SESSIONS_KEY, currentSecUid), {});
  if (!isRecord(parsed)) return {};
  const sessions: ChatSessions = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue;
    const startedAt = numberField(value, ["startedAt"]);
    const lastActivityAt = numberField(value, ["lastActivityAt"]);
    if (!startedAt && !lastActivityAt) continue;
    sessions[key] = {
      startedAt: startedAt || lastActivityAt,
      lastActivityAt: Math.max(startedAt, lastActivityAt),
      summary: stringField(value, ["summary"]).slice(0, SUMMARY_LIMIT),
      compressedThroughAt: numberField(value, ["compressedThroughAt"]),
      compressedMessageCount: Math.max(0, numberField(value, ["compressedMessageCount"])),
    };
  }
  return sessions;
}

export function persistChatSessions(sessions: ChatSessions, currentSecUid?: string) {
  writeJson(getNamespacedKey(CHAT_SESSIONS_KEY, currentSecUid), sessions);
}

export function refreshChatSession(session: ChatSession | undefined, messages: LocalChatMessage[], displayName: string, force = false): ChatSession {
  const sorted = [...messages]
    .filter((message) => !session || message.createdAt >= session.startedAt)
    .sort((a, b) => a.createdAt - b.createdAt);
  const latestAt = sorted[sorted.length - 1]?.createdAt || Date.now();
  const current = session || { startedAt: sorted[0]?.createdAt || latestAt, lastActivityAt: latestAt, summary: "", compressedThroughAt: 0, compressedMessageCount: 0 };
  const candidates = sorted
    .slice(0, Math.max(0, sorted.length - (force ? 4 : RECENT_MESSAGE_COUNT)))
    .filter((message) => message.createdAt > current.compressedThroughAt);
  const chars = candidates.reduce((total, message) => total + (message.text || message.rawContent || "").length, 0);
  if (!force && candidates.length < 6 && chars < 700) return { ...current, lastActivityAt: Math.max(current.lastActivityAt, latestAt) };
  const addition = candidates.map((message) => line(message, displayName)).filter(Boolean).join("\n");
  if (!addition) return { ...current, lastActivityAt: Math.max(current.lastActivityAt, latestAt) };
  return {
    ...current,
    lastActivityAt: Math.max(current.lastActivityAt, latestAt),
    summary: compact([current.summary, addition].filter(Boolean).join("\n")),
    compressedThroughAt: candidates[candidates.length - 1]?.createdAt || current.compressedThroughAt,
    compressedMessageCount: current.compressedMessageCount + candidates.length,
  };
}

export function buildPrivateMessageAiContext(session: ChatSession | undefined, messages: LocalChatMessage[], displayName: string) {
  const recent = [...messages]
    .filter((message) => !session || message.createdAt >= session.startedAt)
    .sort((a, b) => a.createdAt - b.createdAt)
    .filter((message) => !session?.compressedThroughAt || message.createdAt > session.compressedThroughAt)
    .slice(-RECENT_MESSAGE_COUNT)
    .map((message) => line(message, displayName))
    .filter(Boolean)
    .join("\n");
  const context = [session?.summary ? `【已压缩的早期会话】\n${session.summary}` : "", recent ? `【最近往来】\n${recent}` : ""].filter(Boolean).join("\n\n");
  return context.length > CONTEXT_LIMIT ? context.slice(-CONTEXT_LIMIT) : context;
}
