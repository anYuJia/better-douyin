import { ThemeLogo } from "@/components/common/theme-logo";

export function ChatEmptyState() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
      <div className="mb-3 flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] border border-border bg-surface">
        <ThemeLogo className="h-14 w-14 object-contain opacity-90" />
      </div>
      <p className="text-[0.88rem] font-semibold text-text">未选择会话</p>
      <p className="mt-1 max-w-sm text-[0.74rem] leading-relaxed text-text-muted">
        左侧选择好友后再加载聊天内容。
      </p>
    </div>
  );
}
