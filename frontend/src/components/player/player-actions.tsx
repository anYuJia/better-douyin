import {
  ListVideo,
  Heart,
  Info,
  Loader2,
  MessageCircle,
  Star,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, UIEvent as ReactUIEvent } from "react";
import { cn } from "@/lib/utils";
import type { CommentInfo, ShareFriend } from "@/lib/tauri";
import type { VideoQualityOption } from "@/lib/video-media";
import { InlinePlayerButton, PlayerIconButton } from "./player-components";
import type { CommentRepliesState, CommentReplyTarget, PlayerPanel } from "./player-utils";
import { CommentsPanel } from "./player-comments";

// Imported panels
import { VolumePanel } from "./player-volume-control";
import { RatePanel } from "./player-speed-menu";
import { QualityPanel } from "./player-quality-menu";
import { SharePanel } from "./player-share-menu";
import { DownloadPanel, MusicPanel } from "./player-more-menu";

interface RelationButtonsProps {
  showWorkActions: boolean;
  liked: boolean;
  favorited: boolean;
  likeCount: number;
  favoriteCount: number;
  relationSubmitting: "like" | "collect" | null;
  autoPlayNextVideo: boolean;
  onToggleAutoPlayNextVideo: (event: ReactMouseEvent) => void;
  onToggleLike: (event: ReactMouseEvent) => void;
  onToggleCollect: (event: ReactMouseEvent) => void;
}

function RelationButtons({
  showWorkActions,
  liked,
  favorited,
  likeCount,
  favoriteCount,
  relationSubmitting,
  autoPlayNextVideo,
  onToggleAutoPlayNextVideo,
  onToggleLike,
  onToggleCollect,
}: RelationButtonsProps) {
  return (
    <>
      <InlinePlayerButton
        label={autoPlayNextVideo ? "关闭自动播放下一条" : "自动播放下一条"}
        active={autoPlayNextVideo}
        activeClassName="text-accent"
        onClick={onToggleAutoPlayNextVideo}
      >
        <ListVideo className={cn("h-4 w-4", autoPlayNextVideo && "text-accent")} />
      </InlinePlayerButton>

      {showWorkActions && (
        <>
          <InlinePlayerButton
            label="点赞"
            count={likeCount}
            active={liked}
            activeClassName="fill-accent text-accent"
            disabled={relationSubmitting !== null}
            onClick={onToggleLike}
          >
            {relationSubmitting === "like" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Heart className={cn("h-4 w-4", liked && "fill-accent text-accent")} />
            )}
          </InlinePlayerButton>

          <InlinePlayerButton
            label="收藏"
            count={favoriteCount}
            active={favorited}
            activeClassName="fill-warning text-warning"
            disabled={relationSubmitting !== null}
            onClick={onToggleCollect}
          >
            {relationSubmitting === "collect" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star className={cn("h-4 w-4", favorited && "fill-warning text-warning")} />
            )}
          </InlinePlayerButton>
        </>
      )}
    </>
  );
}



interface PlayerActionButtonsProps {
  showWorkActions: boolean;
  liked: boolean;
  favorited: boolean;
  likeCount: number;
  favoriteCount: number;
  relationSubmitting: "like" | "collect" | null;
  autoPlayNextVideo: boolean;
  openPanel: PlayerPanel | null;
  muted: boolean;
  volume: number;
  effectiveVolume: number;
  playbackRate: number;
  qualityOptions: VideoQualityOption[];
  activeQualityOption: VideoQualityOption | null;
  showQualityControl: boolean;
  shareFriends: ShareFriend[];
  shareFriendsLoading: boolean;
  shareFriendsError: string;
  shareSendingFriendKey: string;
  shareSentFriendKeys: Set<string>;
  downloadSubmitting: boolean;
  musicUrl: string;
  bgmPlaying: boolean;
  bgmProxyUrl: string;
  bgmDownloadSubmitting: boolean;
  canDownloadBgm: boolean;
  hasDownloadHandler: boolean;
  // Comment props
  commentsOpen: boolean;
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
  // Callbacks
  onToggleLike: (event: ReactMouseEvent) => void;
  onToggleAutoPlayNextVideo: (event: ReactMouseEvent) => void;
  onToggleCollect: (event: ReactMouseEvent) => void;
  onToggleMute: (event: ReactMouseEvent) => void;
  onVolumeChange: (nextVolume: number) => void;
  onPlaybackRateChange: (rate: number, event: ReactMouseEvent) => void;
  onQualityChange: (qualityKey: string, event: ReactMouseEvent) => void;
  onShareFriendClick: (friend: ShareFriend, event: ReactMouseEvent) => void;
  onDownloadCurrent: (event: ReactMouseEvent) => void;
  onCopyCurrentMediaUrl: (event: ReactMouseEvent) => void;
  onToggleBgm: (event: ReactMouseEvent) => void;
  onDownloadBgm: (event: ReactMouseEvent) => void;
  onShowDetail: () => void;
  onTogglePanel: (panel: PlayerPanel, event: ReactMouseEvent) => void;
  onOpenPanelOnPointerEnter: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onClosePanelOnPointerLeave: (panel: PlayerPanel, event: ReactPointerEvent<HTMLElement>) => void;
  onOpenToolPanel: (panel: PlayerPanel) => void;
  onSchedulePanelClose: (panel?: PlayerPanel) => void;
  onOpenPanelOnPointerDown: (panel: PlayerPanel, event: ReactPointerEvent<HTMLButtonElement>) => void;
  // Comment callbacks
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
  onCloseCommentsPanel: (event?: ReactMouseEvent) => void;
  onOpenCommentsPanel: (event?: ReactMouseEvent | ReactPointerEvent<HTMLElement>, options?: { sticky?: boolean }) => void;
  onMarkCommentsPanelSticky: (event?: ReactMouseEvent | ReactPointerEvent<HTMLElement>) => void;
  onScheduleTransientCommentsClose: (event?: ReactMouseEvent | ReactPointerEvent<HTMLElement>) => void;
  onClearPanelCloseTimer: () => void;
  registerCommentRef?: (cid: string) => (el: HTMLDivElement | null) => void;
  registerReplyRef?: (cid: string) => (el: HTMLDivElement | null) => void;
  highlightCid?: string;
  locatePrompt?: "" | "deleted" | "not_in_first_pages";
  onDismissLocatePrompt?: () => void;
}

export function PlayerActionButtons({
  showWorkActions,
  liked,
  favorited,
  likeCount,
  favoriteCount,
  relationSubmitting,
  autoPlayNextVideo,
  openPanel,
  muted,
  volume,
  effectiveVolume,
  playbackRate,
  qualityOptions,
  activeQualityOption,
  showQualityControl,
  shareFriends,
  shareFriendsLoading,
  shareFriendsError,
  shareSendingFriendKey,
  shareSentFriendKeys,
  downloadSubmitting,
  musicUrl,
  bgmPlaying,
  bgmProxyUrl,
  bgmDownloadSubmitting,
  canDownloadBgm,
  hasDownloadHandler,
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
  currentVideoCommentCount,
  onToggleLike,
  onToggleAutoPlayNextVideo,
  onToggleCollect,
  onToggleMute,
  onVolumeChange,
  onPlaybackRateChange,
  onQualityChange,
  onShareFriendClick,
  onDownloadCurrent,
  onCopyCurrentMediaUrl,
  onToggleBgm,
  onDownloadBgm,
  onShowDetail,
  onTogglePanel,
  onOpenPanelOnPointerEnter,
  onClosePanelOnPointerLeave,
  onOpenToolPanel,
  onSchedulePanelClose,
  onOpenPanelOnPointerDown,
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
  onCloseCommentsPanel,
  onOpenCommentsPanel,
  onMarkCommentsPanelSticky,
  onScheduleTransientCommentsClose,
  onClearPanelCloseTimer,
  registerCommentRef,
  registerReplyRef,
  highlightCid,
  locatePrompt,
  onDismissLocatePrompt,
}: PlayerActionButtonsProps) {
  return (
    <div className="flex min-w-0 max-w-[66vw] items-center gap-1 overflow-visible pb-0.5">
      <RelationButtons
        showWorkActions={showWorkActions}
        liked={liked}
        favorited={favorited}
        likeCount={likeCount}
        favoriteCount={favoriteCount}
        relationSubmitting={relationSubmitting}
        autoPlayNextVideo={autoPlayNextVideo}
        onToggleAutoPlayNextVideo={onToggleAutoPlayNextVideo}
        onToggleLike={onToggleLike}
        onToggleCollect={onToggleCollect}
      />

      <VolumePanel
        openPanel={openPanel}
        muted={muted}
        volume={volume}
        effectiveVolume={effectiveVolume}
        onToggleMute={onToggleMute}
        onVolumeChange={onVolumeChange}
        onTogglePanel={onTogglePanel}
        onOpenPanelOnPointerEnter={onOpenPanelOnPointerEnter}
        onClosePanelOnPointerLeave={onClosePanelOnPointerLeave}
        onOpenToolPanel={onOpenToolPanel}
        onSchedulePanelClose={onSchedulePanelClose}
        onOpenPanelOnPointerDown={onOpenPanelOnPointerDown}
      />

      <RatePanel
        openPanel={openPanel}
        playbackRate={playbackRate}
        onPlaybackRateChange={onPlaybackRateChange}
        onTogglePanel={onTogglePanel}
        onOpenPanelOnPointerEnter={onOpenPanelOnPointerEnter}
        onClosePanelOnPointerLeave={onClosePanelOnPointerLeave}
        onOpenToolPanel={onOpenToolPanel}
        onSchedulePanelClose={onSchedulePanelClose}
        onOpenPanelOnPointerDown={onOpenPanelOnPointerDown}
      />

      <QualityPanel
        openPanel={openPanel}
        qualityOptions={qualityOptions}
        activeQualityOption={activeQualityOption}
        showQualityControl={showQualityControl}
        onQualityChange={onQualityChange}
        onTogglePanel={onTogglePanel}
        onOpenPanelOnPointerEnter={onOpenPanelOnPointerEnter}
        onClosePanelOnPointerLeave={onClosePanelOnPointerLeave}
        onOpenToolPanel={onOpenToolPanel}
        onSchedulePanelClose={onSchedulePanelClose}
        onOpenPanelOnPointerDown={onOpenPanelOnPointerDown}
      />

      {showWorkActions && (
        <div
          className="relative shrink-0"
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch") onOpenCommentsPanel(event);
          }}
          onMouseEnter={() => onOpenCommentsPanel()}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") onScheduleTransientCommentsClose(event);
          }}
          onMouseLeave={() => onScheduleTransientCommentsClose()}
        >
          <PlayerIconButton
            label="评论区"
            onClick={(event) => {
              event.stopPropagation();
              onClearPanelCloseTimer();
              if (commentsOpen) {
                onCloseCommentsPanel(event);
              } else {
                onOpenCommentsPanel(event, { sticky: true });
              }
            }}
            active={commentsOpen}
          >
            <MessageCircle className="h-4 w-4" />
          </PlayerIconButton>
          <AnimatePresence>
            {commentsOpen && (
              <CommentsPanel
                comments={comments}
                commentsLoading={commentsLoading}
                commentsError={commentsError}
                commentsHasMore={commentsHasMore}
                commentsTotal={commentsTotal}
                commentReplies={commentReplies}
                expandedCommentReplyIds={expandedCommentReplyIds}
                commentDiggingIds={commentDiggingIds}
                commentDraft={commentDraft}
                commentSubmitting={commentSubmitting}
                commentAiSuggesting={commentAiSuggesting}
                commentAiSuggestions={commentAiSuggestions}
                commentAiHint={commentAiHint}
                commentReplyTarget={commentReplyTarget}
                currentVideoCommentCount={currentVideoCommentCount}
                currentCommentCount={comments.length}
                onCommentsScroll={onCommentsScroll}
                onToggleCommentReplies={onToggleCommentReplies}
                onToggleCommentLike={onToggleCommentLike}
                onSetCommentReplyTarget={onSetCommentReplyTarget}
                onCommentDraftChange={onCommentDraftChange}
                onSubmitComment={onSubmitComment}
                onSuggestCommentDraft={onSuggestCommentDraft}
                onApplyCommentAiSuggestion={onApplyCommentAiSuggestion}
                onLoadCommentReplies={onLoadCommentReplies}
                onLoadMoreComments={onLoadMoreComments}
                onClose={onCloseCommentsPanel}
                onMarkSticky={onMarkCommentsPanelSticky}
                registerCommentRef={registerCommentRef}
                registerReplyRef={registerReplyRef}
                highlightCid={highlightCid}
                locatePrompt={locatePrompt}
                onDismissLocatePrompt={onDismissLocatePrompt}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {showWorkActions && (
        <SharePanel
          openPanel={openPanel}
          shareFriends={shareFriends}
          shareFriendsLoading={shareFriendsLoading}
          shareFriendsError={shareFriendsError}
          shareSendingFriendKey={shareSendingFriendKey}
          shareSentFriendKeys={shareSentFriendKeys}
          onShareFriendClick={onShareFriendClick}
          onTogglePanel={onTogglePanel}
          onOpenPanelOnPointerEnter={onOpenPanelOnPointerEnter}
          onClosePanelOnPointerLeave={onClosePanelOnPointerLeave}
          onOpenToolPanel={onOpenToolPanel}
          onSchedulePanelClose={onSchedulePanelClose}
          onOpenPanelOnPointerDown={onOpenPanelOnPointerDown}
        />
      )}

      {showWorkActions && (
        <DownloadPanel
          openPanel={openPanel}
          downloadSubmitting={downloadSubmitting}
          hasDownloadHandler={hasDownloadHandler}
          onDownloadCurrent={onDownloadCurrent}
          onCopyCurrentMediaUrl={onCopyCurrentMediaUrl}
          onTogglePanel={onTogglePanel}
          onOpenPanelOnPointerEnter={onOpenPanelOnPointerEnter}
          onClosePanelOnPointerLeave={onClosePanelOnPointerLeave}
          onOpenToolPanel={onOpenToolPanel}
          onSchedulePanelClose={onSchedulePanelClose}
        />
      )}

      {showWorkActions && (
        <MusicPanel
          openPanel={openPanel}
          musicUrl={musicUrl}
          bgmPlaying={bgmPlaying}
          bgmProxyUrl={bgmProxyUrl}
          bgmDownloadSubmitting={bgmDownloadSubmitting}
          canDownloadBgm={canDownloadBgm}
          onToggleBgm={onToggleBgm}
          onDownloadBgm={onDownloadBgm}
          onTogglePanel={onTogglePanel}
          onOpenPanelOnPointerEnter={onOpenPanelOnPointerEnter}
          onClosePanelOnPointerLeave={onClosePanelOnPointerLeave}
          onOpenToolPanel={onOpenToolPanel}
          onSchedulePanelClose={onSchedulePanelClose}
          onOpenPanelOnPointerDown={onOpenPanelOnPointerDown}
        />
      )}

      {showWorkActions && onShowDetail && (
        <PlayerIconButton
          label="查看详情"
          onClick={(event) => {
            event.stopPropagation();
            onShowDetail();
          }}
        >
          <Info className="h-4 w-4" />
        </PlayerIconButton>
      )}
    </div>
  );
}
