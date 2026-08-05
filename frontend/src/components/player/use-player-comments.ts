import { useCallback, useEffect, useRef, useState, type UIEvent as ReactUIEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { getComments, getCommentReplies, publishComment, setCommentLiked, suggestAiInteraction, type CommentInfo, type VideoInfo } from "@/lib/tauri";
import type { CommentRepliesState, CommentReplyTarget, PlayerPanel } from "./player-types";
import { readAiAutomationConfig, rememberAutomationKey, shouldAutomateText } from "@/lib/ai-automation";

const AI_COMMENT_CONTEXT_CHAR_LIMIT = 900;

function trimAiText(value: string, limit = AI_COMMENT_CONTEXT_CHAR_LIMIT) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(-limit) : text;
}

function normalizeAiSuggestions(draft: string, suggestions?: string[]) {
  const items = suggestions && suggestions.length > 0 ? suggestions : [draft];
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, 3);
}

function getAiAutoSendDelayMs(value?: number) {
  const delay = Number(value ?? 0);
  if (!Number.isFinite(delay)) return 0;
  return Math.max(0, Math.min(10000, Math.trunc(delay)));
}

function formatAiAutoBlockHint(reasons?: string[]) {
  const items = (reasons || []).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? `自动发送已阻止：${items.join("，")}` : "";
}

function waitForAiAutoSend(delayMs: number) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

interface UsePlayerCommentsProps {
  open: boolean;
  openPanel: PlayerPanel | null;
  currentVideo: VideoInfo | null;
  showNavigationNotice: (message: string) => void;
  clearPanelCloseTimer: () => void;
  setOpenPanel: (panel: PlayerPanel | null) => void;
  onAutoLikeVideo?: () => Promise<boolean> | boolean;
  onAutoCollectVideo?: () => Promise<boolean> | boolean;
  isVideoLiked?: boolean;
  isVideoCollected?: boolean;
  openComments?: boolean;
  initialComment?: {
    cid: string;
    root_cid?: string;
    is_sub?: boolean;
    text: string;
    digg_count: number;
    create_time: number;
    user: { uid: string; nickname: string; sec_uid: string; avatar: string };
    reply_to_user?: { uid: string; nickname: string; sec_uid: string; avatar: string } | null;
    reply_to_text?: string;
  } | null;
}

export function usePlayerComments({
  open,
  openPanel,
  currentVideo,
  showNavigationNotice,
  clearPanelCloseTimer,
  setOpenPanel,
  onAutoLikeVideo,
  onAutoCollectVideo,
  isVideoLiked = false,
  isVideoCollected = false,
  openComments = false,
  initialComment = null,
}: UsePlayerCommentsProps) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CommentInfo[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [commentsCursor, setCommentsCursor] = useState(0);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [commentsLoadedAwemeId, setCommentsLoadedAwemeId] = useState("");
  const [commentReplies, setCommentReplies] = useState<CommentRepliesState>({});
  const [expandedCommentReplyIds, setExpandedCommentReplyIds] = useState<Set<string>>(() => new Set());
  const [commentDiggingIds, setCommentDiggingIds] = useState<Set<string>>(() => new Set());
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentAiSuggesting, setCommentAiSuggesting] = useState(false);
  const [commentAiSuggestions, setCommentAiSuggestions] = useState<string[]>([]);
  const [commentAiHint, setCommentAiHint] = useState("");
  const [commentReplyTarget, setCommentReplyTarget] = useState<CommentReplyTarget>(null);
  // 通知跳转定位：高亮目标 cid + 定位失败提示。
  const [highlightCid, setHighlightCid] = useState("");
  const [locatePrompt, setLocatePrompt] = useState<"" | "deleted" | "not_in_first_pages">("");
  const commentItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const replyItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const locateDoneRef = useRef(false);
  const locatePageRef = useRef(0);
  const autoRepliedCommentIdsRef = useRef<Set<string>>(new Set());

  const commentsHoverCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const commentsPanelStickyRef = useRef(false);

  const clearCommentsHoverCloseTimer = useCallback(() => {
    if (commentsHoverCloseTimerRef.current) {
      window.clearTimeout(commentsHoverCloseTimerRef.current);
      commentsHoverCloseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (commentsHoverCloseTimerRef.current) {
        window.clearTimeout(commentsHoverCloseTimerRef.current);
      }
    };
  }, []);

  // Reset comments state on video change
  useEffect(() => {
    setOpenPanel(null);
    setComments([]);
    setCommentsError("");
    setCommentsCursor(0);
    setCommentsHasMore(false);
    setCommentsTotal(0);
    setCommentsLoadedAwemeId("");
    setCommentReplies({});
    setExpandedCommentReplyIds(new Set());
  }, [currentVideo?.aweme_id, setOpenPanel]);

  // Handle comments-specific resets on player close
  useEffect(() => {
    if (!open) {
      clearCommentsHoverCloseTimer();
      commentsPanelStickyRef.current = false;
      setCommentsOpen(false);
    }
  }, [open, clearCommentsHoverCloseTimer]);

  // Close comments panel if another tool panel gets opened
  useEffect(() => {
    if (openPanel) {
      clearCommentsHoverCloseTimer();
      commentsPanelStickyRef.current = false;
      setCommentsOpen(false);
    }
  }, [openPanel, clearCommentsHoverCloseTimer]);

  const loadComments = useCallback(async (mode: "initial" | "more" = "initial") => {
    if (!currentVideo?.aweme_id || commentsLoading) return;
    const isMore = mode === "more";
    setCommentsLoading(true);
    setCommentsError("");
    try {
      const result = await getComments(currentVideo.aweme_id, 20, isMore ? commentsCursor : 0);
      if (!result.success) {
        throw new Error(result.message || "获取评论失败");
      }
      const nextComments = Array.isArray(result.comments) ? result.comments : [];
      setComments((prev) => (isMore ? [...prev, ...nextComments] : nextComments));
      setCommentsCursor(Number(result.cursor || 0));
      setCommentsHasMore(Boolean(result.has_more));
      setCommentsTotal(Number(result.total || 0));
      setCommentsLoadedAwemeId(currentVideo.aweme_id);
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : "获取评论失败");
      if (!isMore) {
        setComments([]);
        setCommentsHasMore(false);
      }
    } finally {
      setCommentsLoading(false);
    }
  }, [commentsCursor, commentsLoading, currentVideo?.aweme_id]);

  const loadCommentReplies = useCallback(async (comment: CommentInfo, mode: "initial" | "more" = "initial") => {
    if (!currentVideo?.aweme_id || !comment.cid) return;
    const currentState = commentReplies[comment.cid];
    if (currentState?.loading) return;
    const isMore = mode === "more";
    const cursor = isMore ? currentState?.cursor || 0 : 0;

    setCommentReplies((prev) => ({
      ...prev,
      [comment.cid]: {
        items: isMore ? prev[comment.cid]?.items || [] : prev[comment.cid]?.items || [],
        cursor,
        hasMore: isMore ? prev[comment.cid]?.hasMore ?? false : prev[comment.cid]?.hasMore ?? false,
        loading: true,
        error: "",
        total: prev[comment.cid]?.total || comment.reply_comment_total || 0,
        loaded: prev[comment.cid]?.loaded || false,
      },
    }));

    try {
      const result = await getCommentReplies(currentVideo.aweme_id, comment.cid, 6, cursor);
      if (!result.success) {
        throw new Error(result.message || "获取回复失败");
      }
      const nextReplies = Array.isArray(result.comments) ? result.comments : [];
      setCommentReplies((prev) => {
        const previous = prev[comment.cid];
        return {
          ...prev,
          [comment.cid]: {
            items: isMore ? [...(previous?.items || []), ...nextReplies] : nextReplies,
            cursor: Number(result.cursor || 0),
            hasMore: Boolean(result.has_more),
            loading: false,
            error: "",
            total: Number(result.total || comment.reply_comment_total || nextReplies.length || 0),
            loaded: true,
          },
        };
      });
    } catch (error) {
      setCommentReplies((prev) => ({
        ...prev,
        [comment.cid]: {
          items: prev[comment.cid]?.items || [],
          cursor: prev[comment.cid]?.cursor || 0,
          hasMore: prev[comment.cid]?.hasMore || false,
          loading: false,
          error: error instanceof Error ? error.message : "获取回复失败",
          total: prev[comment.cid]?.total || comment.reply_comment_total || 0,
          loaded: true,
        },
      }));
    }
  }, [commentReplies, currentVideo?.aweme_id]);

  const toggleCommentReplies = useCallback((comment: CommentInfo) => {
    const willExpand = !expandedCommentReplyIds.has(comment.cid);
    setExpandedCommentReplyIds((prev) => {
      const next = new Set(prev);
      if (willExpand) {
        next.add(comment.cid);
      } else {
        next.delete(comment.cid);
      }
      return next;
    });
    const replyState = commentReplies[comment.cid];
    if (willExpand && !replyState?.loaded && !replyState?.loading) {
      void loadCommentReplies(comment, "initial");
    }
  }, [commentReplies, expandedCommentReplyIds, loadCommentReplies]);

  const updateCommentById = useCallback((commentId: string, updater: (comment: CommentInfo) => CommentInfo) => {
    setComments((prev) => prev.map((comment) => (comment.cid === commentId ? updater(comment) : comment)));
    setCommentReplies((prev) => {
      const next: CommentRepliesState = {};
      let anyChanged = false;
      for (const [cid, state] of Object.entries(prev)) {
        let itemsChanged = false;
        const nextItems = state.items.map((reply) => {
          if (reply.cid !== commentId) return reply;
          itemsChanged = true;
          return updater(reply);
        });
        if (itemsChanged) {
          anyChanged = true;
          next[cid] = { ...state, items: nextItems };
        } else {
          next[cid] = state;
        }
      }
      return anyChanged ? next : prev;
    });
  }, []);

  const toggleCommentLike = useCallback(async (comment: CommentInfo, level: number) => {
    if (!currentVideo?.aweme_id || !comment.cid || commentDiggingIds.has(comment.cid)) return;
    const wasLiked = Number(comment.user_digged || 0) > 0;
    const nextLiked = !wasLiked;
    const delta = nextLiked ? 1 : -1;

    setCommentDiggingIds((prev) => new Set(prev).add(comment.cid));
    updateCommentById(comment.cid, (item) => ({
      ...item,
      user_digged: nextLiked ? 1 : 0,
      digg_count: Math.max(0, Number(item.digg_count || 0) + delta),
    }));

    try {
      const result = await setCommentLiked(currentVideo.aweme_id, comment.cid, nextLiked, level);
      if (!result.success) {
        throw new Error(result.message || "评论点赞失败");
      }
    } catch (error) {
      updateCommentById(comment.cid, (item) => ({
        ...item,
        user_digged: wasLiked ? 1 : 0,
        digg_count: Math.max(0, Number(item.digg_count || 0) - delta),
      }));
      showNavigationNotice(error instanceof Error ? error.message : "评论点赞失败");
    } finally {
      setCommentDiggingIds((prev) => {
        const next = new Set(prev);
        next.delete(comment.cid);
        return next;
      });
    }
  }, [commentDiggingIds, currentVideo?.aweme_id, showNavigationNotice, updateCommentById]);

  const publishCommentText = useCallback(async (value: string, successNotice = "评论已发布") => {
    const text = value.trim();
    if (!currentVideo?.aweme_id || !text || commentSubmitting) return false;
    const target = commentReplyTarget;
    setCommentSubmitting(true);
    try {
      const result = await publishComment(
        currentVideo.aweme_id,
        text,
        target?.replyId || "",
        target?.replyToReplyId || ""
      );
      if (!result.success) {
        throw new Error(result.message || "发表评论失败");
      }
      const created = result.comment;
      if (created?.cid) {
        if (target?.replyId) {
          setExpandedCommentReplyIds((prev) => new Set(prev).add(target.replyId));
          setCommentReplies((prev) => {
            const current = prev[target.replyId] || {
              items: [],
              cursor: 0,
              hasMore: false,
              loading: false,
              error: "",
              total: 0,
              loaded: true,
            };
            return {
              ...prev,
              [target.replyId]: {
                ...current,
                items: [created, ...current.items],
                total: current.total + 1,
                loaded: true,
              },
            };
          });
          updateCommentById(target.replyId, (item) => ({
            ...item,
            reply_comment_total: Number(item.reply_comment_total || 0) + 1,
          }));
        } else {
          setComments((prev) => [created, ...prev]);
          setCommentsTotal((prev) => prev + 1);
        }
      } else if (target?.replyId) {
        void loadCommentReplies({ cid: target.replyId } as CommentInfo, "initial");
      } else {
        void loadComments("initial");
      }
      setCommentDraft("");
      setCommentReplyTarget(null);
      showNavigationNotice(successNotice);
      return true;
    } catch (error) {
      showNavigationNotice(error instanceof Error ? error.message : "发表评论失败");
      return false;
    } finally {
      setCommentSubmitting(false);
    }
  }, [
    commentReplyTarget,
    commentSubmitting,
    currentVideo?.aweme_id,
    loadCommentReplies,
    loadComments,
    showNavigationNotice,
    updateCommentById,
  ]);

  const submitComment = useCallback(async () => {
    await publishCommentText(commentDraft);
  }, [commentDraft, publishCommentText]);

  const suggestCommentDraft = useCallback(async () => {
    if (!currentVideo || commentAiSuggesting) return;
    const contextLines = [
      currentVideo.desc ? `视频文案：${currentVideo.desc}` : "",
      currentVideo.author?.nickname ? `作者：${currentVideo.author.nickname}` : "",
      commentReplyTarget?.nickname ? `正在回复：${commentReplyTarget.nickname}` : "",
      comments.slice(0, 5).map((comment) => `${comment.user?.nickname || "用户"}：${comment.text || ""}`).join("\n"),
    ].filter(Boolean);

    setCommentAiSuggesting(true);
    setCommentAiHint("正在生成 AI 评论候选...");
    try {
      const result = await suggestAiInteraction({
        target: "comment",
        context: trimAiText(contextLines.join("\n")),
        incoming_text: trimAiText(currentVideo.desc || "", 360),
        author_name: commentReplyTarget?.nickname || currentVideo.author?.nickname || "",
        tone: "friendly",
        language: "zh-CN",
        max_suggestions: 3,
      });
      const suggestions = normalizeAiSuggestions(result.draft || "", result.suggestions);
      setCommentAiSuggestions(suggestions);
      const autoBlockHint = formatAiAutoBlockHint(result.auto_block_reasons);
      if (suggestions.length === 0) {
        setCommentAiHint("暂时没有生成可用建议，请稍后再试");
      } else if (result.actions?.send_comment) {
        const autoMessages: string[] = [];
        if (result.actions?.like && !isVideoLiked && onAutoLikeVideo && await onAutoLikeVideo()) {
          autoMessages.push("已自动点赞");
        }
        if (result.actions?.collect && !isVideoCollected && onAutoCollectVideo && await onAutoCollectVideo()) {
          autoMessages.push("已自动收藏");
        }
        const delayMs = getAiAutoSendDelayMs(result.auto_send_delay_ms);
        if (delayMs > 0) {
          setCommentAiHint(`${autoMessages.length > 0 ? `${autoMessages.join("，")}；` : ""}将在 ${(delayMs / 1000).toFixed(1)} 秒后自动发布 AI 评论`);
          await waitForAiAutoSend(delayMs);
        }
        if (await publishCommentText(suggestions[0], "AI 评论已自动发布")) {
          autoMessages.push("已自动发布评论");
        } else if (!commentDraft.trim()) {
          setCommentDraft(suggestions[0]);
          autoMessages.push("自动发布失败，已保留 AI 草稿");
        } else {
          autoMessages.push("自动发布失败，原草稿未覆盖");
        }
        setCommentAiHint(autoMessages.join("，"));
      } else if (commentDraft.trim()) {
        const autoMessages: string[] = [];
        if (result.actions?.like && !isVideoLiked && onAutoLikeVideo && await onAutoLikeVideo()) {
          autoMessages.push("已自动点赞");
        }
        if (result.actions?.collect && !isVideoCollected && onAutoCollectVideo && await onAutoCollectVideo()) {
          autoMessages.push("已自动收藏");
        }
        setCommentAiHint(autoBlockHint || "已生成 AI 候选，点击下方短句可替换当前草稿");
        if (autoMessages.length > 0) {
          setCommentAiHint(`${autoMessages.join("，")}；${autoBlockHint || "已生成 AI 候选，点击下方短句可替换当前草稿"}`);
        }
      } else {
        const autoMessages: string[] = [];
        if (result.actions?.like && !isVideoLiked && onAutoLikeVideo && await onAutoLikeVideo()) {
          autoMessages.push("已自动点赞");
        }
        if (result.actions?.collect && !isVideoCollected && onAutoCollectVideo && await onAutoCollectVideo()) {
          autoMessages.push("已自动收藏");
        }
        setCommentDraft(suggestions[0]);
        const manualHint = autoBlockHint || "已填入 AI 草稿，可继续编辑后手动发布";
        setCommentAiHint(autoMessages.length > 0 ? `${autoMessages.join("，")}；${manualHint}` : manualHint);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成评论建议失败";
      setCommentAiHint(message);
      showNavigationNotice(message);
    } finally {
      setCommentAiSuggesting(false);
    }
  }, [commentAiSuggesting, commentDraft, commentReplyTarget, comments, currentVideo, isVideoCollected, isVideoLiked, onAutoCollectVideo, onAutoLikeVideo, publishCommentText, showNavigationNotice]);

  const runCommentsAutomation = useCallback(async () => {
    if (!currentVideo?.aweme_id || comments.length === 0 || commentSubmitting) return;
    const config = await readAiAutomationConfig();
    if (!config?.auto_monitor_comments || !config.auto_send_comments) return;

    let handled = 0;
    for (const comment of comments) {
      if (!comment?.cid || autoRepliedCommentIdsRef.current.has(comment.cid)) continue;
      if (handled >= config.auto_max_actions_per_run) break;
      const matchText = [
        currentVideo.desc,
        currentVideo.author?.nickname,
        comment.user?.nickname,
        comment.text,
      ].filter(Boolean).join(" ");
      if (!shouldAutomateText(matchText, config, "comment")) continue;
      if (!rememberAutomationKey(autoRepliedCommentIdsRef.current, comment.cid)) continue;

      handled += 1;
      try {
        const result = await suggestAiInteraction({
          target: "comment",
          context: trimAiText([
            currentVideo.desc ? `视频文案：${currentVideo.desc}` : "",
            currentVideo.author?.nickname ? `作者：${currentVideo.author.nickname}` : "",
            `正在回复：${comment.user?.nickname || "用户"}`,
            comments.slice(0, 5).map((item) => `${item.user?.nickname || "用户"}：${item.text || ""}`).join("\n"),
          ].filter(Boolean).join("\n")),
          incoming_text: trimAiText(comment.text || "", 360),
          author_name: comment.user?.nickname || "",
          tone: "friendly",
          language: "zh-CN",
          max_suggestions: 3,
        });
        const suggestions = normalizeAiSuggestions(result.draft || "", result.suggestions);
        if (!result.actions?.send_comment || suggestions.length === 0) continue;
        await waitForAiAutoSend(getAiAutoSendDelayMs(result.auto_send_delay_ms));
        const published = await publishComment(
          currentVideo.aweme_id,
          suggestions[0],
          comment.cid,
          "0"
        );
        if (published.success) {
          showNavigationNotice(`已自动回复 ${comment.user?.nickname || "评论"}`);
          if (published.comment?.cid) {
            setExpandedCommentReplyIds((prev) => new Set(prev).add(comment.cid));
            setCommentReplies((prev) => {
              const current = prev[comment.cid] || {
                items: [],
                cursor: 0,
                hasMore: false,
                loading: false,
                error: "",
                total: 0,
                loaded: true,
              };
              return {
                ...prev,
                [comment.cid]: {
                  ...current,
                  items: [published.comment!, ...current.items],
                  total: current.total + 1,
                  loaded: true,
                },
              };
            });
            updateCommentById(comment.cid, (item) => ({
              ...item,
              reply_comment_total: Number(item.reply_comment_total || 0) + 1,
            }));
          } else {
            void loadCommentReplies(comment, "initial");
          }
        } else {
          showNavigationNotice(published.message || "评论区自动回复失败");
        }
      } catch (error) {
        showNavigationNotice(error instanceof Error ? error.message : "评论区自动回复失败");
      }
    }
  }, [commentSubmitting, comments, currentVideo, loadCommentReplies, showNavigationNotice, updateCommentById]);

  const applyCommentAiSuggestion = useCallback((suggestion: string) => {
    setCommentDraft(suggestion);
    setCommentAiHint("已替换为选中的 AI 草稿");
  }, []);

  const handleCommentsScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom > 96 || commentsLoading || !commentsHasMore) return;
    void loadComments("more");
  }, [commentsHasMore, commentsLoading, loadComments]);

  const openCommentsPanel = useCallback((event?: ReactMouseEvent | ReactPointerEvent<HTMLElement>, options?: { sticky?: boolean }) => {
    event?.stopPropagation();
    clearPanelCloseTimer();
    clearCommentsHoverCloseTimer();
    if (options?.sticky) {
      commentsPanelStickyRef.current = true;
    } else if (!commentsOpen) {
      commentsPanelStickyRef.current = false;
    }
    setOpenPanel(null);
    setCommentsOpen(true);
  }, [clearCommentsHoverCloseTimer, clearPanelCloseTimer, commentsOpen, setOpenPanel]);

  const markCommentsPanelSticky = useCallback((event?: ReactMouseEvent | ReactPointerEvent<HTMLElement>) => {
    event?.stopPropagation();
    clearCommentsHoverCloseTimer();
    commentsPanelStickyRef.current = true;
  }, [clearCommentsHoverCloseTimer]);

  const scheduleTransientCommentsClose = useCallback((event?: ReactMouseEvent | ReactPointerEvent<HTMLElement>) => {
    event?.stopPropagation();
    clearCommentsHoverCloseTimer();
    commentsHoverCloseTimerRef.current = window.setTimeout(() => {
      if (!commentsPanelStickyRef.current) {
        setCommentsOpen(false);
      }
      commentsHoverCloseTimerRef.current = null;
    }, 180);
  }, [clearCommentsHoverCloseTimer]);

  const closeCommentsPanel = useCallback((event?: ReactMouseEvent) => {
    event?.stopPropagation();
    clearCommentsHoverCloseTimer();
    commentsPanelStickyRef.current = false;
    setCommentsOpen(false);
  }, [clearCommentsHoverCloseTimer]);

  useEffect(() => {
    if (!commentsOpen || !currentVideo?.aweme_id || commentsLoadedAwemeId === currentVideo.aweme_id) return;
    void loadComments("initial");
  }, [commentsLoadedAwemeId, commentsOpen, currentVideo?.aweme_id, loadComments]);

  useEffect(() => {
    if (!commentsOpen || commentsLoading || comments.length === 0) return;
    void runCommentsAutomation();
  }, [comments, commentsLoading, commentsOpen, runCommentsAutomation]);

  // 通知跳转：打开时强制展开评论区（降级类型 41/45 也展开）。
  useEffect(() => {
    if (!open) return;
    if (openComments || initialComment) {
      setCommentsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 通知跳转：用 insert_ids=cid 拉评论列表，目标评论会被插入返回。
  // cid 在根列表 → 置顶高光根评论；cid 在某根评论的 sub_comments → 展开该根评论高光子评论。
  // 不等 commentsLoadedAwemeId——抢先调 insert_ids 一步到位，省掉自动拉取的普通请求，
  // 避免普通+insert_ids 两次串行请求导致进入慢。
  useEffect(() => {
    if (!initialComment || locateDoneRef.current) return;
    if (locatePageRef.current > 0) return; // 仅拉一次
    locatePageRef.current = 1;
    const { cid, root_cid, is_sub, text, digg_count, create_time, user, reply_to_user } = initialComment;
    const awemeId = currentVideo?.aweme_id;
    if (!awemeId) return;
    // 立即占位标记已加载，阻止自动拉取 effect 并发跑普通请求。
    setCommentsLoadedAwemeId(awemeId);
    setCommentsLoading(true);

    const highlight = (targetCid: string) => {
      setHighlightCid(targetCid);
      window.setTimeout(() => setHighlightCid((cur) => (cur === targetCid ? "" : cur)), 2400);
      window.requestAnimationFrame(() => {
        const node = commentItemRefs.current.get(targetCid) || replyItemRefs.current.get(targetCid);
        if (node) node.scrollIntoView({ block: "center" });
      });
    };

    void (async () => {
      try {
        const targetRootCid = root_cid || cid;
        const result = await getComments(awemeId, 20, 0, targetRootCid);
        if (!result.success || !result.comments) {
          locateDoneRef.current = true;
          setLocatePrompt("deleted");
          return;
        }
        // cid 在根列表 → 置顶高光。
        const asRoot = result.comments.find((c) => c.cid === cid);
        if (asRoot) {
          const ordered = [asRoot, ...result.comments.filter((c) => c.cid !== cid)];
          setComments(ordered);
          setCommentsCursor(Number(result.cursor || 0));
          setCommentsHasMore(Boolean(result.has_more));
          setCommentsTotal(Number(result.total || 0));
          setCommentsLoadedAwemeId(awemeId);
          locateDoneRef.current = true;
          highlight(cid);
          return;
        }
        const rootComment = result.comments.find((c) => c.cid === targetRootCid);
        if (rootComment && is_sub) {
          const repliesResult = await getCommentReplies(awemeId, rootComment.cid, 20, 0);
          const replies = Array.isArray(repliesResult.comments) ? repliesResult.comments : [];
          const targetReply = replies.find((reply) => reply.cid === cid);
          const visibleReplies = targetReply
            ? [targetReply, ...replies.filter((reply) => reply.cid !== cid)]
            : replies;
          setComments([rootComment, ...result.comments.filter((c) => c.cid !== rootComment.cid)]);
          setCommentsCursor(Number(result.cursor || 0));
          setCommentsHasMore(Boolean(result.has_more));
          setCommentsTotal(Number(result.total || 0));
          setCommentsLoadedAwemeId(awemeId);
          setCommentReplies((prev) => ({
            ...prev,
            [rootComment.cid]: {
              items: visibleReplies,
              cursor: Number(repliesResult.cursor || 0),
              hasMore: Boolean(repliesResult.has_more),
              loading: false,
              error: "",
              total: Number(repliesResult.total || rootComment.reply_comment_total || visibleReplies.length || 0),
              loaded: true,
            },
          }));
          setExpandedCommentReplyIds((prev) => new Set(prev).add(rootComment.cid));
          locateDoneRef.current = true;
          if (targetReply) {
            highlight(cid);
          } else {
            setLocatePrompt("not_in_first_pages");
            highlight(rootComment.cid);
          }
          return;
        }
        // cid 在某根评论的 sub_comments → 展开该根评论高光子评论。
        const host = result.comments.find((c) => (c.sub_comments || []).some((s) => s.cid === cid));
        if (host) {
          const subReplies = (host.sub_comments || []) as CommentInfo[];
          const ordered = [
            ...subReplies.filter((r) => r.cid === cid),
            ...subReplies.filter((r) => r.cid !== cid),
          ];
          const hostOrdered = [host, ...result.comments.filter((c) => c.cid !== host.cid)];
          setComments(hostOrdered);
          setCommentsCursor(Number(result.cursor || 0));
          setCommentsHasMore(Boolean(result.has_more));
          setCommentsTotal(Number(result.total || 0));
          setCommentsLoadedAwemeId(awemeId);
          setCommentReplies((prev) => ({
            ...prev,
            [host.cid]: {
              items: ordered,
              cursor: 0,
              hasMore: false,
              loading: false,
              error: "",
              total: subReplies.length,
              loaded: true,
            },
          }));
          setExpandedCommentReplyIds((prev) => new Set(prev).add(host.cid));
          locateDoneRef.current = true;
          highlight(cid);
          return;
        }
        // 兜底：评论已删或接口未返回，用通知数据构造置顶。
        const pinned: CommentInfo = {
          cid,
          text,
          create_time,
          digg_count,
          user_digged: 0,
          reply_comment_total: 0,
          sub_comments: null,
          reply_id: is_sub ? targetRootCid : "",
          reply_to_reply_id: is_sub ? cid : "",
          reply_to_user_id: reply_to_user?.uid || "",
          reply_to_user_name: reply_to_user?.nickname || "",
          user: { uid: user.uid, nickname: user.nickname, sec_uid: user.sec_uid, avatar_thumb: user.avatar },
        };
        setComments((prev) => [pinned, ...prev]);
        locateDoneRef.current = true;
        setLocatePrompt("deleted");
        highlight(cid);
      } catch {
        locateDoneRef.current = true;
        setLocatePrompt("deleted");
      } finally {
        setCommentsLoading(false);
      }
    })();
  }, [initialComment, currentVideo?.aweme_id]);

  // 评论项 ref 回调工厂：el 为 null 时清理 stale 条目。
  const registerCommentRef = useCallback((cid: string) => (el: HTMLDivElement | null) => {
    if (el) commentItemRefs.current.set(cid, el);
    else commentItemRefs.current.delete(cid);
  }, []);
  const registerReplyRef = useCallback((cid: string) => (el: HTMLDivElement | null) => {
    if (el) replyItemRefs.current.set(cid, el);
    else replyItemRefs.current.delete(cid);
  }, []);

  // 播放器关闭时重置定位状态（覆盖同实例复用情况）。
  useEffect(() => {
    if (open) return;
    locateDoneRef.current = false;
    locatePageRef.current = 0;
    setLocatePrompt("");
    setHighlightCid("");
    commentItemRefs.current.clear();
    replyItemRefs.current.clear();
  }, [open]);

  return {
    commentsOpen,
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
    highlightCid,
    locatePrompt,
    registerCommentRef,
    registerReplyRef,
    setLocatePrompt,
    setCommentDraft,
    setCommentReplyTarget,
    loadCommentReplies,
    toggleCommentReplies,
    toggleCommentLike,
    submitComment,
    suggestCommentDraft,
    applyCommentAiSuggestion,
    handleCommentsScroll,
    openCommentsPanel,
    markCommentsPanelSticky,
    scheduleTransientCommentsClose,
    closeCommentsPanel,
    loadComments,
  };
}
