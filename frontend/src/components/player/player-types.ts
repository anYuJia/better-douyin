import type { CommentInfo } from "@/lib/tauri";

export type PlayerPanel = "volume" | "rate" | "quality" | "download" | "music" | "share";

export type CommentRepliesState = Record<
  string,
  {
    items: CommentInfo[];
    cursor: number;
    hasMore: boolean;
    loading: boolean;
    error: string;
    total: number;
    loaded: boolean;
  }
>;

export type CommentReplyTarget = {
  replyId: string;
  replyToReplyId: string;
  nickname: string;
} | null;
