import { Loader2, Heart, Send, Sparkles, X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, UIEvent as ReactUIEvent } from "react";
import { motion } from "framer-motion";
import { cn, formatNumber } from "@/lib/utils";
import { mediaProxyUrl, type CommentInfo } from "@/lib/tauri";
import type { CommentRepliesState, CommentReplyTarget } from "./player-utils";
import { formatCommentTime } from "./player-utils";

interface CommentItemProps {
  comment: CommentInfo;
  replyState: CommentRepliesState[string] | undefined;
  repliesExpanded: boolean;
  commentLiked: boolean;
  commentDigging: boolean;
  commentDiggingIds: Set<string>;
  onToggleCommentReplies: (comment: CommentInfo) => void;
  onToggleCommentLike: (comment: CommentInfo, level: number) => void;
  onSetCommentReplyTarget: (target: CommentReplyTarget) => void;
  onLoadCommentReplies: (comment: CommentInfo, mode: "initial" | "more") => void;
  registerRef?: (el: HTMLDivElement | null) => void;
  registerReplyRef?: (cid: string) => (el: HTMLDivElement | null) => void;
  highlightCid?: string;
}

function CommentItem({
  comment,
  replyState,
  repliesExpanded,
  commentLiked,
  commentDigging,
  commentDiggingIds,
  onToggleCommentReplies,
  onToggleCommentLike,
  onSetCommentReplyTarget,
  onLoadCommentReplies,
  registerRef,
  registerReplyRef,
  highlightCid,
}: CommentItemProps) {
  const avatar = comment.user?.avatar_thumb || "";
  const replies = replyState?.items || [];

  return (
    <div
      ref={registerRef}
      data-cid={comment.cid}
      className={cn(
        "flex gap-2 rounded-lg px-1.5 py-2 transition-colors hover:bg-white/[0.04]",
        highlightCid === comment.cid && "bg-accent-soft/50 border-l-2 border-l-accent"
      )}
    >
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white/[0.08]">
        {avatar ? (
          <img
            src={mediaProxyUrl(avatar, "image")}
            alt={comment.user?.nickname || ""}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-accent/25 text-[0.72rem] font-bold text-white">
            {(comment.user?.nickname || "?").slice(0, 1)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[0.72rem] font-semibold text-white/72">
            {comment.user?.nickname || "抖音用户"}
          </span>
          <span className="shrink-0 text-[0.62rem] text-white/32">
            {formatCommentTime(comment.create_time)}
          </span>
        </div>
        {comment.text ? (
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[0.76rem] leading-5 text-white/90">
            {comment.text}
          </div>
        ) : comment.sticker_url ? (
          <img
            src={mediaProxyUrl(comment.sticker_url, "image")}
            alt="评论表情"
            className="mt-1 max-h-20 max-w-24 rounded-md object-contain"
          />
        ) : (
          <div className="mt-0.5 text-[0.76rem] leading-5 text-white/62">[表情]</div>
        )}
        <div className="mt-1 flex items-center gap-3 text-[0.62rem] text-white/36">
          {comment.ip_label && <span>IP {comment.ip_label}</span>}
          <button
            type="button"
            disabled={commentDigging}
            onClick={(event) => {
              event.stopPropagation();
              void onToggleCommentLike(comment, 1);
            }}
            className={cn(
              "flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-white/[0.06]",
              commentLiked ? "text-red-400" : "text-white/36 hover:text-white/70",
              commentDigging && "cursor-wait opacity-70"
            )}
          >
            <Heart className={cn("h-3 w-3", commentLiked && "fill-current")} />
            <span>{comment.digg_count > 0 ? formatNumber(comment.digg_count) : "赞"}</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSetCommentReplyTarget({
                replyId: comment.cid,
                replyToReplyId: "0",
                nickname: comment.user?.nickname || "抖音用户",
              });
            }}
            className="rounded-md px-1 py-0.5 transition-colors hover:bg-white/[0.06] hover:text-white/70"
          >
            回复
          </button>
          {comment.reply_comment_total > 0 && <span>{formatNumber(comment.reply_comment_total)} 回复</span>}
        </div>
        {comment.reply_comment_total > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCommentReplies(comment);
            }}
            className="mt-1.5 flex h-6 items-center rounded-md px-1.5 text-[0.64rem] font-semibold text-white/42 transition-colors hover:bg-white/[0.06] hover:text-white/70"
          >
            {repliesExpanded ? "收起回复" : `展开 ${formatNumber(comment.reply_comment_total)} 条回复`}
          </button>
        )}
        {repliesExpanded && (replies.length > 0 || replyState?.loading || replyState?.error) && (
          <div className="mt-2 space-y-2 border-l border-white/[0.08] pl-2.5">
            {replies.map((reply) => {
              const replyAvatar = reply.user?.avatar_thumb || "";
              const replyLiked = Number(reply.user_digged || 0) > 0;
              const replyDigging = commentDiggingIds.has(reply.cid);
              const replyToName =
                reply.reply_to_user_name &&
                reply.reply_to_user_name !== comment.user?.nickname &&
                reply.reply_to_user_name !== reply.user?.nickname
                  ? reply.reply_to_user_name
                  : "";
              return (
                <div
                  key={reply.cid}
                  ref={registerReplyRef?.(reply.cid)}
                  data-reply-cid={reply.cid}
                  className={cn(
                    "flex gap-2",
                    highlightCid === reply.cid && "bg-accent-soft/50 border-l-2 border-l-accent rounded-lg"
                  )}
                >
                  <div className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-white/[0.08]">
                    {replyAvatar ? (
                      <img
                        src={mediaProxyUrl(replyAvatar, "image")}
                        alt={reply.user?.nickname || ""}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/[0.08] text-[0.58rem] font-bold text-white/70">
                        {(reply.user?.nickname || "?").slice(0, 1)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[0.68rem] font-semibold text-white/58">
                        {reply.user?.nickname || "抖音用户"}
                      </span>
                      {replyToName && (
                        <>
                          <span className="shrink-0 text-[0.58rem] text-white/26">回复</span>
                          <span className="truncate text-[0.66rem] font-semibold text-accent/80">
                            @{replyToName}
                          </span>
                        </>
                      )}
                      <span className="shrink-0 text-[0.58rem] text-white/28">
                        {formatCommentTime(reply.create_time)}
                      </span>
                    </div>
                    {reply.text ? (
                      <div className="mt-0.5 whitespace-pre-wrap break-words text-[0.7rem] leading-4 text-white/78">
                        {reply.text}
                      </div>
                    ) : reply.sticker_url ? (
                      <img
                        src={mediaProxyUrl(reply.sticker_url, "image")}
                        alt="回复表情"
                        className="mt-1 max-h-16 max-w-20 rounded-md object-contain"
                      />
                    ) : (
                      <div className="mt-0.5 text-[0.7rem] leading-4 text-white/50">[表情]</div>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-[0.58rem] text-white/30">
                      {reply.ip_label && <span>IP {reply.ip_label}</span>}
                      <button
                        type="button"
                        disabled={replyDigging}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onToggleCommentLike(reply, 2);
                        }}
                        className={cn(
                          "flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-white/[0.06]",
                          replyLiked ? "text-red-400" : "text-white/30 hover:text-white/62",
                          replyDigging && "cursor-wait opacity-70"
                        )}
                      >
                        <Heart className={cn("h-2.5 w-2.5", replyLiked && "fill-current")} />
                        <span>{reply.digg_count > 0 ? formatNumber(reply.digg_count) : "赞"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSetCommentReplyTarget({
                            replyId: comment.cid,
                            replyToReplyId: reply.cid,
                            nickname: reply.user?.nickname || "抖音用户",
                          });
                        }}
                        className="rounded-md px-1 py-0.5 transition-colors hover:bg-white/[0.06] hover:text-white/62"
                      >
                        回复
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {replyState?.error && (
              <div className="text-[0.62rem] text-white/42">{replyState.error}</div>
            )}
            {(replyState?.hasMore || replyState?.loading) && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void onLoadCommentReplies(comment, "more");
                }}
                disabled={replyState?.loading}
                className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[0.64rem] font-semibold text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/70 disabled:cursor-wait disabled:opacity-60"
              >
                {replyState?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {replyState?.loading ? "正在加载回复" : "查看更多回复"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface CommentsPanelProps {
  comments: CommentInfo[];
  commentsLoading: boolean;
  commentsError: string;
  commentsHasMore: boolean;
  commentsTotal: number;
  commentReplies: CommentRepliesState;
  expandedCommentReplyIds: Set<string>;
  commentDiggingIds: Set<string>;
  commentDraft: string;
  commentSubmitting: boolean;
  commentAiSuggesting: boolean;
  commentAiSuggestions: string[];
  commentAiHint: string;
  commentReplyTarget: CommentReplyTarget;
  currentVideoCommentCount: number;
  currentCommentCount: number;
  onCommentsScroll: (event: ReactUIEvent<HTMLDivElement>) => void;
  onToggleCommentReplies: (comment: CommentInfo) => void;
  onToggleCommentLike: (comment: CommentInfo, level: number) => void;
  onSetCommentReplyTarget: (target: CommentReplyTarget) => void;
  onCommentDraftChange: (draft: string) => void;
  onSubmitComment: () => void;
  onSuggestCommentDraft: () => void;
  onApplyCommentAiSuggestion: (suggestion: string) => void;
  onLoadCommentReplies: (comment: CommentInfo, mode: "initial" | "more") => void;
  onLoadMoreComments: () => void;
  onClose: (event?: ReactMouseEvent) => void;
  onMarkSticky: (event?: ReactMouseEvent | ReactPointerEvent<HTMLElement>) => void;
  registerCommentRef?: (cid: string) => (el: HTMLDivElement | null) => void;
  registerReplyRef?: (cid: string) => (el: HTMLDivElement | null) => void;
  highlightCid?: string;
  locatePrompt?: "" | "deleted" | "not_in_first_pages";
  onDismissLocatePrompt?: () => void;
}

export function CommentsPanel({
  comments,
  commentsLoading,
  commentsError,
  commentsHasMore,
  commentsTotal,
  commentReplies,
  expandedCommentReplyIds,
  commentDiggingIds,
  commentDraft,
  commentSubmitting,
  commentAiSuggesting,
  commentAiSuggestions,
  commentAiHint,
  commentReplyTarget,
  currentVideoCommentCount,
  currentCommentCount,
  onCommentsScroll,
  onToggleCommentReplies,
  onToggleCommentLike,
  onSetCommentReplyTarget,
  onCommentDraftChange,
  onSubmitComment,
  onSuggestCommentDraft,
  onApplyCommentAiSuggestion,
  onLoadCommentReplies,
  onLoadMoreComments,
  onClose,
  onMarkSticky,
  registerCommentRef,
  registerReplyRef,
  highlightCid,
  locatePrompt,
  onDismissLocatePrompt,
}: CommentsPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.985 }}
      transition={{ duration: 0.18 }}
      className="fixed bottom-20 right-3 z-50 flex w-[min(380px,calc(100vw-24px))] max-h-[min(520px,72vh)] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#111111]/80 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:right-5"
      onPointerEnter={onMarkSticky}
      onMouseEnter={() => onMarkSticky()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.08] px-3">
        <div className="min-w-0 flex-1">
          <div className="text-[0.78rem] font-semibold text-white/90">评论区</div>
          <div className="text-[0.64rem] text-white/42">
            {formatNumber(commentsTotal || currentVideoCommentCount || currentCommentCount || 0)} 条评论
          </div>
        </div>
        <button
          type="button"
          aria-label="关闭评论区"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="share-friends-scroll min-h-0 flex-1 overflow-y-auto p-2" onScroll={onCommentsScroll}>
        {locatePrompt && (
          <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[0.72rem] text-warning">
            <span>{locatePrompt === "deleted" ? "该评论可能已被删除" : "未在前 60 条评论中找到，可在评论区手动查找"}</span>
            <button
              type="button"
              onClick={onDismissLocatePrompt}
              className="shrink-0 text-warning/70 hover:text-warning"
            >
              ×
            </button>
          </div>
        )}
        {commentsLoading && comments.length === 0 ? (
          <div className="flex h-32 items-center justify-center gap-2 text-[0.74rem] text-white/58">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在获取评论
          </div>
        ) : commentsError && comments.length === 0 ? (
          <div className="rounded-lg bg-white/[0.06] px-3 py-3 text-[0.74rem] leading-5 text-white/62">
            {commentsError}
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-lg bg-white/[0.06] px-3 py-3 text-[0.74rem] text-white/55">
            暂无评论
          </div>
        ) : (
          <div className="space-y-1.5">
            {comments.map((comment) => {
              const replyState = commentReplies[comment.cid];
              const repliesExpanded = expandedCommentReplyIds.has(comment.cid);
              const commentLiked = Number(comment.user_digged || 0) > 0;
              const commentDigging = commentDiggingIds.has(comment.cid);
              return (
                <CommentItem
                  key={comment.cid}
                  comment={comment}
                  replyState={replyState}
                  repliesExpanded={repliesExpanded}
                  commentLiked={commentLiked}
                  commentDigging={commentDigging}
                  commentDiggingIds={commentDiggingIds}
                  onToggleCommentReplies={onToggleCommentReplies}
                  onToggleCommentLike={onToggleCommentLike}
                  onSetCommentReplyTarget={onSetCommentReplyTarget}
                  onLoadCommentReplies={onLoadCommentReplies}
                  registerRef={registerCommentRef?.(comment.cid)}
                  registerReplyRef={registerReplyRef}
                  highlightCid={highlightCid}
                />
              );
            })}
            {(commentsHasMore || commentsLoading) && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onLoadMoreComments();
                }}
                disabled={commentsLoading}
                className="mt-1 flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-white/[0.06] text-[0.72rem] font-semibold text-white/68 transition-colors hover:bg-white/[0.1] disabled:cursor-wait disabled:opacity-60"
              >
                {commentsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {commentsLoading ? "正在加载" : "加载更多"}
              </button>
            )}
            {commentsError && (
              <div className="rounded-lg bg-white/[0.06] px-2 py-2 text-[0.68rem] text-white/55">
                {commentsError}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-white/[0.08] p-2">
        {commentReplyTarget && (
          <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white/[0.05] px-2 py-1 text-[0.64rem] text-white/48">
            <span className="min-w-0 flex-1 truncate">回复 {commentReplyTarget.nickname}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSetCommentReplyTarget(null);
              }}
              className="rounded px-1 text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white/80"
            >
              取消
            </button>
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-end gap-2">
            <textarea
              value={commentDraft}
              onChange={(event) => onCommentDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void onSubmitComment();
                }
              }}
              placeholder={commentReplyTarget ? `回复 ${commentReplyTarget.nickname}` : "写评论..."}
              rows={1}
              className="share-friends-scroll min-h-9 max-h-20 flex-1 resize-none rounded-lg border border-white/[0.08] bg-white/[0.06] px-2.5 py-2 text-[0.74rem] leading-5 text-white outline-none placeholder:text-white/30 focus:border-white/18"
            />
            <button
              type="button"
              aria-label="AI 生成评论草稿"
              title={commentDraft.trim() ? "AI 生成候选评论，不会自动发布" : "AI 生成评论草稿"}
              disabled={commentAiSuggesting}
              onClick={(event) => {
                event.stopPropagation();
                void onSuggestCommentDraft();
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.06] text-white/72 transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-white/28"
            >
              {commentAiSuggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            </button>
            <button
              type="button"
              disabled={!commentDraft.trim() || commentSubmitting}
              onClick={(event) => {
                event.stopPropagation();
                void onSubmitComment();
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-white/30"
            >
              {commentSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          {(commentAiHint || commentAiSuggestions.length > 1) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {commentAiHint && <span className="mr-1 text-[0.66rem] text-white/42">{commentAiHint}</span>}
              {commentAiSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion}-${index}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onApplyCommentAiSuggestion(suggestion);
                  }}
                  className="max-w-full truncate rounded-full border border-white/[0.08] bg-white/[0.06] px-2 py-0.5 text-[0.64rem] text-white/68 transition-colors hover:bg-white/[0.1] hover:text-white"
                  title={suggestion}
                >
                  候选 {index + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
