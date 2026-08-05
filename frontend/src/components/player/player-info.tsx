import { cn } from "@/lib/utils";
import { mediaProxyUrl } from "@/lib/tauri";

interface AuthorInfoProps {
  authorAvatar: string;
  authorName: string;
  canOpenAuthor: boolean;
  onAuthorClick: () => void;
}

export function AuthorInfo({
  authorAvatar,
  authorName,
  canOpenAuthor,
  onAuthorClick,
}: AuthorInfoProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-full py-0.5 pr-2 transition-[background-color,opacity,transform]",
        canOpenAuthor
          ? "cursor-pointer hover:bg-white/10 active:scale-[0.98]"
          : "cursor-default opacity-75"
      )}
      disabled={!canOpenAuthor}
      title={canOpenAuthor ? "进入作者主页" : "作者信息不可用"}
      aria-label={canOpenAuthor ? `进入 ${authorName} 主页` : "作者信息不可用"}
      onClick={(event) => {
        event.stopPropagation();
        onAuthorClick();
      }}
    >
      <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full border-2 border-white/30 bg-white/10">
        {authorAvatar ? (
          <img
            src={mediaProxyUrl(authorAvatar, "image")}
            alt={authorName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-accent text-[0.72rem] font-bold text-white">
            {authorName.slice(0, 1)}
          </div>
        )}
      </div>
      <span className="truncate text-[0.88rem] font-semibold drop-shadow-md">@{authorName}</span>
    </button>
  );
}
