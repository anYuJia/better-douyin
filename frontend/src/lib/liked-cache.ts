import { normalizeLikedVideo, type UserInfo, type VideoInfo } from "@/lib/tauri";
import { LIKED_VIDEOS_SOFT_LIMIT, trimVideoListWindow } from "@/lib/list-limits";
import { readJson, removeStorageKey, writeJson } from "@/lib/storage";

const LIKED_VIDEOS_KEY = "liked_videos_cache";
const LIKED_AUTHORS_KEY = "liked_authors_cache";
const CACHE_VERSION = 4;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CacheEnvelope<T> {
  version: number;
  data: T[];
  count?: number;
  timestamp: number;
}

function readCache<T>(key: string): CacheEnvelope<T> | null {
  const parsed = readJson<CacheEnvelope<T> | null>(key, null);
  if (!parsed) return null;
  if (parsed.version !== CACHE_VERSION) {
    removeStorageKey(key);
    return null;
  }
  if (Date.now() - parsed.timestamp > MAX_AGE_MS) {
    removeStorageKey(key);
    return null;
  }
  return parsed;
}

function writeCache<T>(key: string, data: T[]) {
  const envelope: CacheEnvelope<T> = {
    version: CACHE_VERSION,
    data,
    count: data.length,
    timestamp: Date.now(),
  };
  writeJson(key, envelope);
}

function scopedKey(baseKey: string, scope: string) {
  const trimmed = scope.trim();
  return trimmed ? `${baseKey}:${trimmed}` : "";
}

export function loadLikedVideosCache(scope: string): VideoInfo[] {
  const key = scopedKey(LIKED_VIDEOS_KEY, scope);
  if (!key) return [];
  const cache = readCache<unknown>(key);
  if (!cache?.data) return [];
  return cache.data.map(normalizeLikedVideo).filter(Boolean) as VideoInfo[];
}

export function saveLikedVideosCache(videos: VideoInfo[], scope: string) {
  const key = scopedKey(LIKED_VIDEOS_KEY, scope);
  if (!key) return;
  writeCache(key, trimVideoListWindow(videos, LIKED_VIDEOS_SOFT_LIMIT));
}

export function loadLikedAuthorsCache(): UserInfo[] {
  const cache = readCache<UserInfo>(LIKED_AUTHORS_KEY);
  return cache?.data || [];
}

export function saveLikedAuthorsCache(authors: UserInfo[]) {
  writeCache(LIKED_AUTHORS_KEY, authors);
}
