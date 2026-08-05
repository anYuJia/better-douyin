import { type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import { Film, ImagePlus, Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  FriendStatusItem,
  PendingImageAttachment,
} from "./friends-status-types";

interface FriendsChatInputProps {
  friend: FriendStatusItem | null;
  draft: string;
  onDraftChange: (secUid: string, value: string) => void;
  onSendMessage: () => void;
  onPickImage: () => void;
  onPickVideo: () => void;
  onSuggestReply: () => void;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  videoInputRef: React.RefObject<HTMLInputElement | null>;
  onImageInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onVideoInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  pendingImages: PendingImageAttachment[];
  onRemovePendingImage: (id: string) => void;
  onDraftKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onDraftPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  canSend: boolean;
  textSending: boolean;
  aiSuggesting: boolean;
  aiSuggestions: string[];
  aiHint: string;
  onApplyAiSuggestion: (suggestion: string) => void;
  onClearAiSuggestions: () => void;
  displayName: string;
}

export function FriendsChatInput({
  friend,
  draft,
  onDraftChange,
  onSendMessage,
  onPickImage,
  onPickVideo,
  onSuggestReply,
  imageInputRef,
  videoInputRef,
  onImageInputChange,
  onVideoInputChange,
  pendingImages,
  onRemovePendingImage,
  onDraftKeyDown,
  onDraftPaste,
  canSend,
  textSending,
  aiSuggesting,
  aiSuggestions,
  aiHint,
  onApplyAiSuggestion,
  onClearAiSuggestions,
  displayName,
}: FriendsChatInputProps) {
  return (
    <div className="border-t border-border bg-surface/40 p-3">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onImageInputChange}
        />
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={onVideoInputChange} />
        {pendingImages.length > 0 && (
          <div className="col-span-3 mb-1 flex max-h-28 gap-2 overflow-x-auto rounded-[14px] border border-border bg-surface-solid p-2">
            {pendingImages.map((image) => (
              <div
                key={image.id}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[12px] border border-border bg-surface-raised"
              >
                <img src={image.previewUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemovePendingImage(image.id)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/70"
                  aria-label="移除图片"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!friend}
            onClick={onPickImage}
            className="h-10 w-10 px-0"
            title="发送图片"
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="outline" disabled={!friend} onClick={onPickVideo} className="h-10 w-10 px-0" title="发送视频（最大 20MB）">
            <Film className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!friend || aiSuggesting}
            onClick={onSuggestReply}
            className="h-10 w-10 px-0"
            title={draft.trim() ? "AI 生成候选回复，不会自动发送" : "AI 生成回复草稿"}
            aria-label="AI 生成回复草稿"
          >
            {aiSuggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <Textarea
          value={draft}
          onChange={(event) => friend && onDraftChange(friend.secUid, event.target.value)}
          onKeyDown={onDraftKeyDown}
          onPaste={onDraftPaste}
          disabled={!friend}
          placeholder={friend ? `给 ${displayName} 写点内容...` : "选择好友后输入"}
          className="h-10 min-h-10 resize-none bg-surface-solid py-2 leading-5"
        />
        <Button disabled={!canSend || textSending} onClick={onSendMessage} className="h-10 px-4 gap-1.5">
          {textSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          发送
        </Button>
        {(aiHint || aiSuggestions.length > 1) && (
          <div className="col-span-3 flex items-center justify-between gap-1.5 pt-1.5 border-t border-border/30 mt-1 select-none">
            <div className="flex flex-wrap items-center gap-1.5">
              {aiHint && <span className="mr-1 text-[0.68rem] text-text-muted">{aiHint}</span>}
              {aiSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion}-${index}`}
                  type="button"
                  onClick={() => onApplyAiSuggestion(suggestion)}
                  className="max-w-full truncate rounded-full border border-accent/20 bg-accent-soft px-2.5 py-1 text-[0.68rem] text-accent transition hover:border-accent/40 hover:bg-accent/10 cursor-pointer"
                  title={suggestion}
                >
                  候选 {index + 1}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClearAiSuggestions}
              className="rounded-full p-1 text-text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-text transition-colors cursor-pointer shrink-0"
              title="清除 AI 建议"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
