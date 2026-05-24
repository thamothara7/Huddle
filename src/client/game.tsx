import './index.css';

import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ActionResponse,
  InitResponse,
  QueueGroup,
  QueueItem,
} from '../shared/api';

const POLL_MS = 5000;

const useQueue = () => {
  const [groups, setGroups] = useState<QueueGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/init');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: InitResponse = await res.json();
      setGroups(data.groups);
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

  return { groups, loading, error, refresh };
};

const ItemRow = ({
  item,
  busy,
  onAction,
}: {
  item: QueueItem;
  busy: boolean;
  onAction: (a: 'approve' | 'remove') => void;
}) => (
  <li className="p-3 flex justify-between items-start gap-3 text-sm border-t border-gray-100 dark:border-gray-800">
    <div className="flex-1 min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-wide text-gray-500">
        {item.type} · {item.itemId}
      </div>
      {item.title && (
        <div className="text-gray-900 dark:text-gray-100 truncate">
          {item.title}
        </div>
      )}
      <div className="text-gray-600 dark:text-gray-400 text-xs mt-0.5">
        {item.reportReasons.length > 0
          ? item.reportReasons.join(' · ')
          : '(no reason given)'}
        {item.reportCount > 1 ? ` · ${item.reportCount} reports` : ''}
      </div>
    </div>
    <div className="flex gap-2 shrink-0">
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
  </li>
);

const Group = ({
  group,
  expanded,
  onToggle,
  busy,
  onAction,
}: {
  group: QueueGroup;
  expanded: boolean;
  onToggle: () => void;
  busy: string | null;
  onAction: (itemId: string, a: 'approve' | 'remove') => void;
}) => (
  <li className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full text-left p-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
    >
      <span className="font-medium">u/{group.authorName}</span>
      <span className="text-xs text-gray-500">
        {group.items.length} item{group.items.length === 1 ? '' : 's'}{' '}
        {expanded ? '▾' : '▸'}
      </span>
    </button>
    {expanded && (
      <ul>
        {group.items.map((item) => (
          <ItemRow
            key={item.itemId}
            item={item}
            busy={busy === item.itemId}
            onAction={(a) => onAction(item.itemId, a)}
          />
        ))}
      </ul>
    )}
  </li>
);

const App = () => {
  const { groups, loading, error, refresh } = useQueue();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
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
              expanded={expanded.has(g.groupKey)}
              onToggle={() => toggle(g.groupKey)}
              busy={busy}
              onAction={act}
            />
          ))}
        </ul>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
