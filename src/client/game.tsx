import './index.css';

import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo } from '@devvit/web/client';
import type {
  ActionEntry,
  ActionResponse,
  BulkActionResponse,
  ContextPeekResponse,
  InitResponse,
  QueueGroup,
  QueueItem,
  RecentEntry,
  SummaryResponse,
  UserFacts,
} from '../shared/api';

const POLL_MS = 5000;

const useQueue = () => {
  const [groups, setGroups] = useState<QueueGroup[]>([]);
  const [subredditName, setSubredditName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/init');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: InitResponse = await res.json();
      setGroups(data.groups);
      setSubredditName(data.subredditName);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { groups, subredditName, loading, error, refresh };
};

const useSummary = (itemId: string) => {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/summary?itemId=${encodeURIComponent(itemId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: SummaryResponse) => {
        if (alive) setSummary(data.summary);
      })
      .catch(() => {
        if (alive) setSummary(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [itemId]);

  return { summary, loading };
};

const typeLabel = (t: 'post' | 'comment') => (t === 'post' ? 'Post' : 'Comment');

const redditUrl = (
  item: Pick<QueueItem, 'itemId' | 'type' | 'permalink' | 'parentPostId'>,
  subredditName: string
): string | null => {
  if (item.permalink) {
    return item.permalink.startsWith('http')
      ? item.permalink
      : `https://reddit.com${item.permalink.startsWith('/') ? '' : '/'}${item.permalink}`;
  }
  if (!subredditName) return null;
  if (item.type === 'post' && item.itemId.startsWith('t3_')) {
    const id = item.itemId.slice(3);
    return `https://reddit.com/r/${subredditName}/comments/${id}/`;
  }
  if (item.type === 'comment' && item.itemId.startsWith('t1_') && item.parentPostId?.startsWith('t3_')) {
    const postId = item.parentPostId.slice(3);
    const commentId = item.itemId.slice(3);
    return `https://reddit.com/r/${subredditName}/comments/${postId}/_/${commentId}/`;
  }
  return null;
};

const ItemRow = ({
  item,
  subredditName,
  busy,
  onAction,
  onOpenDrawer,
}: {
  item: QueueItem;
  subredditName: string;
  busy: boolean;
  onAction: (a: 'approve' | 'remove') => void;
  onOpenDrawer: () => void;
}) => {
  const { summary, loading } = useSummary(item.itemId);
  const url = redditUrl(item, subredditName);
  return (
    <li className="p-3 flex justify-between items-start gap-3 text-sm border-t border-gray-100 dark:border-gray-800">
      <button
        onClick={onOpenDrawer}
        className="flex-1 min-w-0 text-left hover:bg-gray-50 dark:hover:bg-gray-800 -m-1 p-1 rounded transition-colors"
      >
        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">
          {typeLabel(item.type)}{' '}
          <span className="font-mono text-gray-400">· {item.itemId}</span>
        </div>
        {item.title && (
          <div className="text-gray-900 dark:text-gray-100 truncate font-medium">
            {item.title}
          </div>
        )}
        <div className="text-gray-700 dark:text-gray-300 text-xs mt-1 leading-snug">
          {loading ? (
            <span className="inline-block animate-pulse bg-gray-200 dark:bg-gray-700 h-3 w-48 rounded" />
          ) : (
            summary ?? '(summary unavailable)'
          )}
        </div>
        <div className="text-gray-500 text-[11px] mt-0.5">
          Reports:{' '}
          {item.reportReasons.length > 0
            ? item.reportReasons.join(' · ')
            : '(no reason given)'}
          {item.reportCount > 1 ? ` · ${item.reportCount} total` : ''}
        </div>
      </button>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {url && (
          <button
            onClick={() => navigateTo(url)}
            className="text-[11px] text-gray-500 hover:text-gray-900 dark:hover:text-white underline"
          >
            Open ↗
          </button>
        )}
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => onAction('approve')}
            className="px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-800 disabled:opacity-50 text-xs"
          >
            Approve
          </button>
          <button
            disabled={busy}
            onClick={() => onAction('remove')}
            className="px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-800 disabled:opacity-50 text-xs"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
};

const Group = ({
  group,
  subredditName,
  expanded,
  onToggle,
  busy,
  bulkBusy,
  onAction,
  onBulk,
  onOpenDrawer,
}: {
  group: QueueGroup;
  subredditName: string;
  expanded: boolean;
  onToggle: () => void;
  busy: string | null;
  bulkBusy: boolean;
  onAction: (itemId: string, a: 'approve' | 'remove') => void;
  onBulk: (a: 'approve' | 'remove') => void;
  onOpenDrawer: (item: QueueItem) => void;
}) => (
  <li className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
    <div className="p-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
      <button onClick={onToggle} className="flex-1 text-left min-w-0">
        <span className="font-medium">u/{group.authorName}</span>
      </button>
      <div className="flex items-center gap-2 shrink-0">
        <button
          disabled={bulkBusy}
          onClick={() => onBulk('approve')}
          className="px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-800 disabled:opacity-50 text-xs"
          title={`Approve all ${group.items.length} items from u/${group.authorName}`}
        >
          Approve all
        </button>
        <button
          disabled={bulkBusy}
          onClick={() => onBulk('remove')}
          className="px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-800 disabled:opacity-50 text-xs"
          title={`Remove all ${group.items.length} items from u/${group.authorName}`}
        >
          Remove all
        </button>
        <button
          onClick={onToggle}
          className="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white px-1"
        >
          {group.items.length} {expanded ? '▾' : '▸'}
        </button>
      </div>
    </div>
    {expanded && (
      <ul>
        {group.items.map((item) => (
          <ItemRow
            key={item.itemId}
            item={item}
            subredditName={subredditName}
            busy={busy === item.itemId || bulkBusy}
            onAction={(a) => onAction(item.itemId, a)}
            onOpenDrawer={() => onOpenDrawer(item)}
          />
        ))}
      </ul>
    )}
  </li>
);

const FactsTable = ({ facts }: { facts: UserFacts }) => {
  const rows: Array<[string, string]> = [
    ['Account age', `${facts.accountAgeDays} day${facts.accountAgeDays === 1 ? '' : 's'}`],
    ['Posts in sub', String(facts.postsInSubTotal)],
    ['Comments in sub', String(facts.commentsInSubTotal)],
    ['Active last 7d', String(facts.inSubLast7d)],
    ['Removed in sub', String(facts.removedInSubTotal)],
  ];
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-gray-100 dark:border-gray-800">
            <td className="py-1 pr-2 text-gray-500">{k}</td>
            <td className="py-1 font-mono text-right">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const STATUS_BADGE: Record<RecentEntry['status'], { label: string; cls: string }> = {
  approved: { label: '✓', cls: 'bg-green-100 text-green-800' },
  removed: { label: '✗', cls: 'bg-red-100 text-red-800' },
  spam: { label: 'spam', cls: 'bg-gray-800 text-white' },
  pending: { label: '⏳', cls: 'bg-yellow-100 text-yellow-800' },
};

const RecentList = ({ recent }: { recent: RecentEntry[] }) => {
  if (recent.length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">No recent activity tracked yet.</p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {recent.map((r) => {
        const badge = STATUS_BADGE[r.status];
        return (
          <li key={r.itemId} className="flex items-start gap-2 text-xs">
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded font-mono text-[10px] ${badge.cls}`}
            >
              {badge.label}
            </span>
            <span className="text-gray-700 dark:text-gray-300 truncate">
              {r.title}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

const ACTION_COLORS: Record<ActionEntry['action'], string> = {
  approve: 'bg-green-500',
  remove: 'bg-red-500',
  spam: 'bg-gray-900',
};

const Timeline = ({ actions }: { actions: ActionEntry[] }) => {
  if (actions.length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">No mod actions in the last 30 days.</p>
    );
  }
  const now = Date.now();
  const windowMs = 30 * 24 * 60 * 60 * 1000;
  return (
    <div>
      <div className="relative h-6 bg-gray-100 dark:bg-gray-800 rounded">
        {actions.map((a, idx) => {
          const ageMs = now - a.timestamp;
          const pct = Math.max(
            0,
            Math.min(100, ((windowMs - ageMs) / windowMs) * 100)
          );
          const yJitter = (idx % 3) * 4;
          return (
            <div
              key={`${a.itemId}-${a.timestamp}`}
              title={`${a.action} by ${a.modId} · ${new Date(a.timestamp).toLocaleDateString()}`}
              className={`absolute w-1.5 h-1.5 rounded-full ${ACTION_COLORS[a.action]}`}
              style={{
                left: `${pct}%`,
                top: `${8 + yJitter}px`,
                transform: 'translateX(-50%)',
              }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 mt-1">
        <span>30d ago</span>
        <span>today</span>
      </div>
    </div>
  );
};

const ContextPeekDrawer = ({
  item,
  subredditName,
  onClose,
}: {
  item: QueueItem;
  subredditName: string;
  onClose: () => void;
}) => {
  const itemId = item.itemId;
  const url = redditUrl(item, subredditName);
  const [data, setData] = useState<ContextPeekResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetch(`/api/context-peek?itemId=${encodeURIComponent(itemId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: ContextPeekResponse) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive)
          setError(e instanceof Error ? e.message : 'Failed to load context');
      });
    return () => {
      alive = false;
    };
  }, [itemId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <aside className="w-[360px] max-w-full bg-white dark:bg-gray-900 shadow-xl overflow-y-auto">
        <header className="p-3 border-b border-gray-200 dark:border-gray-800 flex justify-between items-start sticky top-0 bg-white dark:bg-gray-900">
          <div className="min-w-0">
            <h2 className="font-semibold text-sm truncate">
              Context · u/{data?.authorName ?? '…'}
            </h2>
            <p className="text-[10px] text-gray-500 font-mono truncate">
              {itemId}
            </p>
            {url && (
              <button
                onClick={() => navigateTo(url)}
                className="text-[11px] text-gray-500 hover:text-gray-900 dark:hover:text-white underline mt-1"
              >
                Open on Reddit ↗
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 dark:hover:text-white text-xl leading-none ml-2"
          >
            ×
          </button>
        </header>
        <div className="p-3 space-y-4">
          {error && (
            <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
          )}
          {!data && !error && (
            <p className="text-xs text-gray-500">Loading context…</p>
          )}
          {data && (
            <>
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Facts the AI saw
                </h3>
                <FactsTable facts={data.facts} />
              </section>
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Last 5 in this sub
                </h3>
                <RecentList recent={data.recent} />
              </section>
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  30-day mod-action timeline
                </h3>
                <Timeline actions={data.actions} />
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
};

const App = () => {
  const { groups, subredditName, loading, error, refresh } = useQueue();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusyKey, setBulkBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drawerItem, setDrawerItem] = useState<QueueItem | null>(null);

  useEffect(() => {
    if (groups.length === 1) {
      setExpanded((prev) => new Set(prev).add(groups[0]!.groupKey));
    }
  }, [groups.length]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const act = async (itemId: string, action: 'approve' | 'remove') => {
    setBusy(itemId);
    setActionError(null);
    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ActionResponse = await res.json();
      if (!data.ok) throw new Error('action returned not-ok');
      if (drawerItem?.itemId === itemId) setDrawerItem(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const bulkAct = async (group: QueueGroup, action: 'approve' | 'remove') => {
    const verb = action === 'approve' ? 'approve' : 'remove';
    const msg = `${verb === 'approve' ? 'Approve' : 'Remove'} all ${group.items.length} items from u/${group.authorName}?`;
    if (!window.confirm(msg)) return;
    setBulkBusyKey(group.groupKey);
    setActionError(null);
    try {
      const res = await fetch('/api/action-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: group.items.map((i) => i.itemId),
          action,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BulkActionResponse = await res.json();
      if (data.failCount > 0) {
        setActionError(
          `${data.okCount} ${verb}d, ${data.failCount} failed`
        );
      }
      if (drawerItem && group.items.some((i) => i.itemId === drawerItem.itemId)) {
        setDrawerItem(null);
      }
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusyKey(null);
    }
  };

  const itemCount = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4">
      <div className="max-w-3xl mx-auto">
        <header className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-bold">Huddle</h1>
          <span className="text-xs text-gray-500">
            {loading
              ? 'Loading…'
              : `${itemCount} item${itemCount === 1 ? '' : 's'} in ${groups.length} group${groups.length === 1 ? '' : 's'}`}
          </span>
        </header>

        {(error || actionError) && (
          <div className="mb-3 p-2 rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
            {actionError ?? error}
          </div>
        )}

        {!loading && groups.length === 0 && !error && (
          <div className="text-center text-gray-500 py-12">
            Modqueue is empty. Reports will appear here clustered by user.
          </div>
        )}

        <ul className="space-y-2">
          {groups.map((g) => (
            <Group
              key={g.groupKey}
              group={g}
              subredditName={subredditName}
              expanded={expanded.has(g.groupKey)}
              onToggle={() => toggle(g.groupKey)}
              busy={busy}
              bulkBusy={bulkBusyKey === g.groupKey}
              onAction={act}
              onBulk={(a) => bulkAct(g, a)}
              onOpenDrawer={setDrawerItem}
            />
          ))}
        </ul>
      </div>

      {drawerItem && (
        <ContextPeekDrawer
          item={drawerItem}
          subredditName={subredditName}
          onClose={() => setDrawerItem(null)}
        />
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
