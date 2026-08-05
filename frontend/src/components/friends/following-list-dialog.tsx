import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, RefreshCw, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getFollowingList, mediaProxyUrl, type FollowingUser } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

function displayId(user: FollowingUser) {
  return user.unique_id || user.short_id || user.uid || user.sec_uid;
}

function formatCount(value: number | undefined) {
  const count = Math.max(0, Number(value) || 0);
  if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
  return String(count);
}

function mergeUsers(current: FollowingUser[], incoming: FollowingUser[]) {
  const map = new Map(current.map((user) => [user.sec_uid, user]));
  incoming.forEach((user) => {
    if (user.sec_uid) map.set(user.sec_uid, { ...map.get(user.sec_uid), ...user });
  });
  return Array.from(map.values());
}

interface FollowingListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (user: FollowingUser) => Promise<void>;
  onStartChat: (user: FollowingUser) => void;
}

export function FollowingListDialog({
  open,
  onOpenChange,
  onOpenProfile,
  onStartChat,
}: FollowingListDialogProps) {
  const [users, setUsers] = useState<FollowingUser[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  const loadPage = useCallback(async (reset = false) => {
    if (loadingRef.current) return;
    const offset = reset ? 0 : nextOffset;
    loadingRef.current = true;
    if (reset) {
      setLoading(true);
      setError("");
    } else {
      setLoadingMore(true);
    }
    try {
      const result = await getFollowingList({ offset, count: PAGE_SIZE });
      if (!result.success) throw new Error(result.message || "获取关注列表失败");
      const nextUsers = Array.isArray(result.users) ? result.users.filter((user) => user.sec_uid) : [];
      setUsers((current) => (reset ? nextUsers : mergeUsers(current, nextUsers)));
      const nextOffsetValue = Math.max(offset + nextUsers.length, Number(result.next_offset || 0) || 0);
      setNextOffset(nextOffsetValue);
      setTotal(Number(result.total || 0) || 0);
      setHasMore(Boolean(result.has_more) && nextOffsetValue > offset);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "获取关注列表失败");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [nextOffset]);

  useEffect(() => {
    if (!open) return;
    if (users.length === 0) void loadPage(true);
  }, [loadPage, open, users.length]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!open || !target || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadPage(false);
      },
      { root: scrollRef.current, rootMargin: "220px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadPage, loading, loadingMore, open, users.length]);

  const handleRefresh = () => {
    setNextOffset(0);
    setHasMore(true);
    void loadPage(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] max-w-[760px] flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 pr-14">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-[1rem]">
                <Users className="h-4 w-4 text-accent" />
                我的关注
              </DialogTitle>
              <DialogDescription className="mt-1">
                {total > 0 ? `共 ${total} 个关注，已加载 ${users.length} 个` : "查看关注的人，直接进入主页或私信"}
              </DialogDescription>
            </div>
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={loading || loadingMore} className="h-8 shrink-0 px-3">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新
            </Button>
          </div>
        </DialogHeader>

        {error && (
          <div className="mx-5 mt-4 rounded-[var(--radius-sm)] border border-danger/25 bg-danger-soft px-3 py-2 text-[0.78rem] text-danger">
            {error}
          </div>
        )}

        <div ref={scrollRef} className="min-h-[360px] flex-1 overflow-y-auto px-5 py-4">
          {loading && users.length === 0 ? (
            <div className="flex min-h-[280px] items-center justify-center text-[0.82rem] text-text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载关注列表
            </div>
          ) : users.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[16px] border border-border bg-surface">
                <Users className="h-5 w-5 text-text-muted" />
              </div>
              <p className="text-[0.86rem] text-text-secondary">暂无关注列表</p>
              <p className="mt-1 text-[0.75rem] text-text-muted">登录状态可用后会在这里显示当前账号关注的人</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {users.map((user) => {
                const avatar = user.avatar_thumb || user.avatar_medium || user.avatar_larger;
                const subtitle = user.secondary_text || user.signature || displayId(user);
                return (
                  <div
                    key={user.sec_uid}
                    className="grid min-w-0 grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2.5"
                  >
                    <div className="h-10 w-10 overflow-hidden rounded-full bg-surface-raised">
                      {avatar ? (
                        <img src={mediaProxyUrl(avatar, "image")} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[0.82rem] font-bold text-text-muted">
                          {user.nickname.slice(0, 1) || "关"}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[0.84rem] font-semibold text-text">{user.nickname || "抖音用户"}</span>
                        {Number(user.live_status || 0) > 0 && (
                          <span className="rounded-full bg-danger-soft px-1.5 py-0.5 text-[0.62rem] font-semibold text-danger">直播中</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[0.7rem] text-text-muted">{subtitle}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[0.64rem] text-text-muted">
                        <span>粉丝 {formatCount(user.follower_count)}</span>
                        <span>作品 {formatCount(user.aweme_count)}</span>
                        <span className={cn(Number(user.follower_status || 0) > 0 && "text-success")}>
                          {Number(user.follower_status || 0) > 0 ? "互相关注" : "已关注"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="icon-sm" variant="outline" title="查看主页" onClick={() => void onOpenProfile(user)}>
                        <UserRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon-sm" title="进入私信" disabled={!user.uid} onClick={() => onStartChat(user)}>
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              <div ref={loadMoreRef} className="flex min-h-8 items-center justify-center py-2 text-[0.72rem] text-text-muted">
                {loadingMore ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    正在加载更多关注
                  </>
                ) : hasMore ? "继续下滑加载更多" : "已加载全部关注"}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
