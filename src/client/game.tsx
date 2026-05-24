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
  ModSuggestion,
  QueueGroup,
  QueueItem,
  RecentEntry,
  RejectWithReasonResponse,
  SnoovatarResponse,
  SuggestionResponse,
  SuggestReasonResponse,
  SummaryResponse,
  UserActionResponse,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async refresh; setState happens after a tick
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { groups, subredditName, loading, error, refresh };
};

const useSnoovatar = (username: string) => {
  const [url, setUrl] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  const fetchOnce = useCallback(
    async (refresh: boolean) => {
      if (!username) return;
      try {
        const res = await fetch(
          `/api/snoovatar?username=${encodeURIComponent(username)}${refresh ? '&refresh=1' : ''}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SnoovatarResponse = await res.json();
        setUrl(data.url ?? null);
      } catch {
        setUrl(null);
      } finally {
        setResolved(true);
      }
    },
    [username]
  );

  useEffect(() => {
    if (!username) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when username changes
    setResolved(false);
    setUrl(null);
    void fetchOnce(false);
  }, [username, fetchOnce]);

  return { url, resolved, retry: () => fetchOnce(true) };
};

const Avatar = ({
  username,
  size,
  gradientCls,
}: {
  username: string;
  size: 'sm' | 'md';
  gradientCls: string;
}) => {
  const { url } = useSnoovatar(username);
  const [broken, setBroken] = useState(false);
  const initial = initialFor(username);
  const sizeCls = size === 'sm' ? 'w-8 h-8 text-sm' : 'w-9 h-9 text-sm';

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when url changes
    setBroken(false);
  }, [url]);

  const showImage = url && !broken;

  return (
    <div
      className={`shrink-0 ${sizeCls} rounded-full bg-gradient-to-br ${gradientCls} grid place-items-center text-white font-bold shadow-sm select-none overflow-hidden`}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </div>
  );
};

const useSuggestion = (itemId: string) => {
  const [suggestion, setSuggestion] = useState<ModSuggestion | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/suggestion?itemId=${encodeURIComponent(itemId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: SuggestionResponse) => {
        if (alive) setSuggestion(data.suggestion);
      })
      .catch(() => {
        if (alive) setSuggestion(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [itemId]);

  return { suggestion, loading };
};

const useSummary = (itemId: string) => {
  const [summary, setSummary] = useState<string | null>(null);
  const [source, setSource] = useState<'cache' | 'llm' | 'fallback' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/summary?itemId=${encodeURIComponent(itemId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: SummaryResponse) => {
        if (alive) {
          setSummary(data.summary);
          setSource(data.source);
        }
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

  return { summary, source, loading };
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
  if (
    item.type === 'comment' &&
    item.itemId.startsWith('t1_') &&
    item.parentPostId?.startsWith('t3_')
  ) {
    const postId = item.parentPostId.slice(3);
    const commentId = item.itemId.slice(3);
    return `https://reddit.com/r/${subredditName}/comments/${postId}/_/${commentId}/`;
  }
  return null;
};

const initialFor = (name: string): string =>
  (name || '?').replace(/^u\//, '').charAt(0).toUpperCase() || '?';

const profileUrl = (username: string): string =>
  `https://www.reddit.com/user/${encodeURIComponent(username)}/`;

const stopAnd =
  <T extends { stopPropagation: () => void }>(fn: () => void) =>
  (e: T) => {
    e.stopPropagation();
    fn();
  };

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
    aria-hidden
  >
    <path
      d="M6 4 L10 8 L6 12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden>
    <line
      x1="3.5"
      y1="3.5"
      x2="12.5"
      y2="12.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <line
      x1="12.5"
      y1="3.5"
      x2="3.5"
      y2="12.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const avatarGradient = (seed: string): string => {
  const palette = [
    'from-indigo-400 to-purple-500',
    'from-sky-400 to-cyan-500',
    'from-emerald-400 to-teal-500',
    'from-fuchsia-400 to-pink-500',
    'from-amber-400 to-orange-500',
    'from-violet-400 to-indigo-500',
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
};

const SUGGESTION_STYLE: Record<
  Exclude<ModSuggestion['action'], 'review'>,
  { label: string; cls: string; dot: string }
> = {
  approve: {
    label: 'Approve',
    cls: 'bg-emerald-50 border-emerald-200/60 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800/50 dark:text-emerald-100',
    dot: 'bg-emerald-500',
  },
  remove: {
    label: 'Remove',
    cls: 'bg-rose-50 border-rose-200/60 text-rose-900 dark:bg-rose-950/30 dark:border-rose-800/50 dark:text-rose-100',
    dot: 'bg-rose-500',
  },
  spam: {
    label: 'Spam',
    cls: 'bg-gray-100 border-gray-300/60 text-gray-900 dark:bg-gray-800/60 dark:border-gray-700/50 dark:text-gray-100',
    dot: 'bg-gray-900 dark:bg-gray-100',
  },
};

const CONFIDENCE_LABEL: Record<ModSuggestion['confidence'], string> = {
  high: 'high confidence',
  medium: 'medium confidence',
  low: 'low confidence',
};

const SuggestionChip = ({ suggestion }: { suggestion: ModSuggestion }) => {
  if (suggestion.action === 'review') return null;
  const style = SUGGESTION_STYLE[suggestion.action];
  return (
    <div
      className={`mt-2.5 px-2.5 py-2 rounded-lg border ${style.cls}`}
      role="note"
      aria-label={`AI suggestion: ${style.label}`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className={`inline-block w-2 h-2 rounded-full ${style.dot}`}
          aria-hidden
        />
        <span className="text-[10px] uppercase tracking-wider font-semibold opacity-70">
          AI suggests
        </span>
        <span className="text-xs font-bold">{style.label}</span>
        <span className="text-[10px] font-normal opacity-60">
          · {CONFIDENCE_LABEL[suggestion.confidence]}
        </span>
      </div>
      <p className="text-[11px] leading-snug opacity-90">{suggestion.why}</p>
    </div>
  );
};

const ItemRow = ({
  item,
  subredditName,
  busy,
  onAction,
  onRejected,
  onOpenDrawer,
}: {
  item: QueueItem;
  subredditName: string;
  busy: boolean;
  onAction: (a: 'approve' | 'remove') => void;
  onRejected: () => void;
  onOpenDrawer: () => void;
}) => {
  const { summary, source, loading } = useSummary(item.itemId);
  const { suggestion } = useSuggestion(item.itemId);
  const url = redditUrl(item, subredditName);
  const isAi = source === 'llm' || source === 'cache';

  // Reject-with-reason inline panel state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const openRejectPanel = () => {
    setRejectOpen(true);
    setRejectError(null);
  };

  const closeRejectPanel = () => {
    setRejectOpen(false);
    setReasonText('');
    setSuggesting(false);
    setRejecting(false);
    setRejectError(null);
  };

  const suggestReason = async () => {
    setSuggesting(true);
    setRejectError(null);
    try {
      const res = await fetch(
        `/api/suggest-reason?itemId=${encodeURIComponent(item.itemId)}`
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const data: SuggestReasonResponse = await res.json();
      setReasonText(data.reason);
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'suggest failed');
    } finally {
      setSuggesting(false);
    }
  };

  const confirmReject = async () => {
    const trimmed = reasonText.trim();
    if (trimmed.length < 10) {
      setRejectError('Reason must be at least 10 characters.');
      return;
    }
    setRejecting(true);
    setRejectError(null);
    try {
      const res = await fetch('/api/reject-with-reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.itemId, reason: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const data: RejectWithReasonResponse = await res.json();
      if (!data.ok) throw new Error('reject returned not-ok');
      closeRejectPanel();
      onRejected();
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'reject failed');
    } finally {
      setRejecting(false);
    }
  };

  return (
    <li className="px-3 sm:px-4 py-3 border-t border-gray-100 dark:border-gray-800/60 hover:bg-gray-50/60 dark:hover:bg-gray-900/40 transition-colors">
      <button
        onClick={onOpenDrawer}
        className="w-full text-left group block"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1 text-[10px] uppercase tracking-wider font-semibold">
          <span className="text-gray-500 dark:text-gray-400">
            {typeLabel(item.type)}
          </span>
          <span className="font-mono normal-case tracking-normal text-gray-400 dark:text-gray-500 truncate max-w-[140px]">
            {item.itemId}
          </span>
          {url && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                navigateTo(url);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  navigateTo(url);
                }
              }}
              className="text-orange-600 dark:text-orange-400 normal-case tracking-normal hover:underline cursor-pointer"
            >
              Open
            </span>
          )}
        </div>

        {item.title && (
          <p className="font-semibold text-gray-900 dark:text-gray-100 truncate mb-1.5 group-hover:text-orange-700 dark:group-hover:text-orange-300 transition-colors">
            {item.title}
          </p>
        )}

        <p
          className={`text-sm leading-relaxed mb-1.5 break-words ${
            isAi
              ? 'text-gray-800 dark:text-gray-200'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 mr-1.5 rounded text-[9px] font-mono uppercase tracking-wider align-baseline ${
              loading
                ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                : isAi
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {loading ? '...' : isAi ? 'AI' : 'raw'}
          </span>
          {loading ? (
            <span className="inline-block animate-pulse bg-gray-200 dark:bg-gray-800 h-4 w-40 rounded align-middle" />
          ) : summary && summary.trim().length > 0 ? (
            summary
          ) : (
            <span className="italic text-gray-500">
              (empty summary — source={source ?? 'none'})
            </span>
          )}
        </p>

        {(item.reportReasons.length > 0 ||
          !(item.modReports && item.modReports.length > 0)) && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 break-words">
            <span className="font-medium text-gray-600 dark:text-gray-300 mr-1">
              Reports:
            </span>
            {item.reportReasons.length > 0
              ? item.reportReasons.join(' · ')
              : 'none'}
            {item.reportCount > 1 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium">
                {item.reportCount}
              </span>
            )}
          </p>
        )}

        {item.modReports && item.modReports.length > 0 && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300 break-words">
            <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase tracking-wider bg-amber-100 dark:bg-amber-900/40 align-baseline">
              MOD
            </span>
            {item.modReports.map((r, i) => (
              <span key={`${r.reason}-${i}`}>
                {i > 0 && ' · '}
                {r.reason}
                {r.modName && (
                  <span className="opacity-70"> by u/{r.modName}</span>
                )}
              </span>
            ))}
          </p>
        )}
      </button>

      {!rejectOpen && suggestion && suggestion.action !== 'review' && (
        <SuggestionChip suggestion={suggestion} />
      )}

      {!rejectOpen && (
        <div className="mt-2.5 space-y-1.5">
          <div className="flex gap-1.5">
            <button
              disabled={busy}
              onClick={() => onAction('approve')}
              className="flex-1 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 dark:text-emerald-300 disabled:opacity-50 text-xs font-medium border border-emerald-200/50 dark:border-emerald-800/50 transition-colors"
              aria-label="Approve"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => onAction('remove')}
              className="flex-1 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 dark:text-rose-300 disabled:opacity-50 text-xs font-medium border border-rose-200/50 dark:border-rose-800/50 transition-colors"
              aria-label="Remove"
            >
              Remove
            </button>
          </div>
          <button
            disabled={busy}
            onClick={openRejectPanel}
            className="w-full px-3 py-1.5 rounded-lg bg-rose-50/40 hover:bg-rose-50 text-rose-700/90 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 dark:text-rose-300/90 disabled:opacity-50 text-[11px] font-medium border border-rose-200/60 dark:border-rose-900/50 transition-colors"
            aria-label="Reject with reason"
          >
            Reject with reason
          </button>
        </div>
      )}

      {rejectOpen && (
        <div className="mt-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/30 p-3">
          <p className="text-[11px] font-semibold text-rose-800 dark:text-rose-200 mb-1.5">
            Removal reason
          </p>
          <p className="text-[10px] text-rose-700/80 dark:text-rose-300/70 mb-2">
            Will be posted as a distinguished, stickied reply visible to
            the author and the community.
          </p>
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            disabled={rejecting || suggesting}
            rows={4}
            placeholder="Explain why this is being removed. Cite the rule or the report reason."
            className="w-full px-2.5 py-2 rounded-md border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-rose-400/50 disabled:opacity-60 resize-y min-h-[80px]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
            <button
              disabled={suggesting || rejecting}
              onClick={suggestReason}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 dark:text-indigo-300 disabled:opacity-50 text-xs font-medium border border-indigo-200/50 dark:border-indigo-800/50 transition-colors"
            >
              {suggesting ? 'Generating...' : 'Suggest with AI'}
            </button>
            <div className="flex gap-1.5">
              <button
                disabled={rejecting || suggesting}
                onClick={closeRejectPanel}
                className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-gray-100 text-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800 dark:text-gray-200 disabled:opacity-50 text-xs font-medium border border-gray-200 dark:border-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={
                  rejecting || suggesting || reasonText.trim().length < 10
                }
                onClick={confirmReject}
                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white dark:bg-rose-500 dark:hover:bg-rose-400 disabled:opacity-50 text-xs font-semibold border border-rose-600 dark:border-rose-500 transition-colors"
              >
                {rejecting ? 'Removing...' : 'Confirm reject'}
              </button>
            </div>
          </div>
          {rejectError && (
            <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
              {rejectError}
            </p>
          )}
        </div>
      )}
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
  onRejected,
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
  onRejected: () => void;
  onOpenDrawer: (item: QueueItem) => void;
}) => {
  const gradient = avatarGradient(group.authorName);
  const [pendingBulk, setPendingBulk] = useState<'approve' | 'remove' | null>(
    null
  );

  useEffect(() => {
    if (!pendingBulk) return;
    const id = setTimeout(() => setPendingBulk(null), 3000);
    return () => clearTimeout(id);
  }, [pendingBulk]);

  const handleBulk = (action: 'approve' | 'remove') => {
    if (pendingBulk === action) {
      setPendingBulk(null);
      onBulk(action);
    } else {
      setPendingBulk(action);
    }
  };

  return (
    <li className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden shadow-sm">
      <div className="px-3 sm:px-4 py-3 bg-gray-50/60 dark:bg-gray-900/60 border-b border-gray-200/60 dark:border-gray-800/60">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
            aria-expanded={expanded}
          >
            <Avatar
              username={group.authorName}
              size="md"
              gradientCls={gradient}
            />
            <div className="min-w-0">
              <p className="font-semibold truncate text-gray-900 dark:text-gray-100">
                u/{group.authorName}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={stopAnd(() => navigateTo(profileUrl(group.authorName)))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      navigateTo(profileUrl(group.authorName));
                    }
                  }}
                  title={`Open u/${group.authorName}'s profile`}
                  className="ml-1.5 text-[11px] font-normal text-orange-600 dark:text-orange-400 hover:underline cursor-pointer align-baseline"
                >
                  profile
                </span>
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {group.items.length} reported item
                {group.items.length === 1 ? '' : 's'}
                {(() => {
                  const total = group.items.reduce(
                    (sum, i) => sum + (i.reportCount || 0),
                    0
                  );
                  return total > group.items.length ? (
                    <>
                      {' · '}
                      <span className="font-medium text-gray-600 dark:text-gray-300">
                        {total}
                      </span>{' '}
                      reports
                    </>
                  ) : null;
                })()}
              </p>
            </div>
          </button>
          <button
            onClick={onToggle}
            className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronIcon open={expanded} />
          </button>
        </div>
        {!expanded && (
          <div className="mt-2.5 flex gap-1.5">
            <button
              disabled={bulkBusy}
              onClick={() => handleBulk('approve')}
              className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                pendingBulk === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:border-emerald-500 animate-pulse'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200/50 dark:border-emerald-800/50'
              }`}
              title={`Approve all ${group.items.length} items from u/${group.authorName}`}
            >
              {pendingBulk === 'approve'
                ? `Confirm: approve ${group.items.length}`
                : 'Approve all'}
            </button>
            <button
              disabled={bulkBusy}
              onClick={() => handleBulk('remove')}
              className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                pendingBulk === 'remove'
                  ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 dark:bg-rose-500 dark:hover:bg-rose-400 dark:border-rose-500 animate-pulse'
                  : 'bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 dark:text-rose-300 border-rose-200/50 dark:border-rose-800/50'
              }`}
              title={`Remove all ${group.items.length} items from u/${group.authorName}`}
            >
              {pendingBulk === 'remove'
                ? `Confirm: remove ${group.items.length}`
                : 'Remove all'}
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <ul className="list-none">
          {group.items.map((item) => (
            <ItemRow
              key={item.itemId}
              item={item}
              subredditName={subredditName}
              busy={busy === item.itemId || bulkBusy}
              onAction={(a) => onAction(item.itemId, a)}
              onRejected={onRejected}
              onOpenDrawer={() => onOpenDrawer(item)}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

const FactsTable = ({ facts }: { facts: UserFacts }) => {
  const rows: Array<[string, string | number]> = [
    ['Account age', `${facts.accountAgeDays} day${facts.accountAgeDays === 1 ? '' : 's'}`],
    ['Posts in sub', facts.postsInSubTotal],
    ['Comments in sub', facts.commentsInSubTotal],
    ['Active last 7d', facts.inSubLast7d],
    ['Removed in sub', facts.removedInSubTotal],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-900/60"
        >
          <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
          <dd className="font-mono font-semibold text-gray-900 dark:text-gray-100">
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
};

const STATUS_BADGE: Record<
  RecentEntry['status'],
  { label: string; cls: string }
> = {
  approved: {
    label: 'ok',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  removed: {
    label: 'rm',
    cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
  spam: {
    label: 'sp',
    cls: 'bg-gray-800 text-white dark:bg-gray-700',
  },
  pending: {
    label: 'pn',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
};

const RecentList = ({ recent }: { recent: RecentEntry[] }) => {
  if (recent.length === 0) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400 italic">
        No recent activity tracked since Huddle was installed.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5 list-none">
      {recent.map((r) => {
        const badge = STATUS_BADGE[r.status];
        return (
          <li
            key={r.itemId}
            className="flex items-center gap-2 text-xs py-1 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-900/60"
          >
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded font-mono text-[10px] uppercase ${badge.cls}`}
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
  approve: 'bg-emerald-500',
  remove: 'bg-rose-500',
  spam: 'bg-gray-900 dark:bg-gray-100',
  ban: 'bg-purple-600',
  mute: 'bg-amber-500',
};

const relativeTime = (timestamp: number, now: number): string => {
  const diff = Math.max(0, now - timestamp);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return 'just now';
  if (diff < hr) {
    const m = Math.max(1, Math.round(diff / min));
    return `${m} min ago`;
  }
  if (diff < day) {
    const h = Math.max(1, Math.round(diff / hr));
    return `${h} hr ago`;
  }
  const d = Math.max(1, Math.round(diff / day));
  return `${d} day${d === 1 ? '' : 's'} ago`;
};

const TICKS: Array<{ label: string; pct: number }> = [
  { label: '21d', pct: 30 },
  { label: '14d', pct: 53.33 },
  { label: '7d', pct: 76.67 },
];

const ACTION_KINDS: Array<ActionEntry['action']> = [
  'approve',
  'remove',
  'spam',
  'ban',
  'mute',
];

const DAY_MS = 24 * 60 * 60 * 1000;

const Timeline = ({ actions }: { actions: ActionEntry[] }) => {
  const [now] = useState(() => Date.now());
  if (actions.length === 0) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400 italic">
        No mod actions in the last 30 days.
      </p>
    );
  }
  const mostRecent = actions.reduce(
    (max, a) => (a.timestamp > max ? a.timestamp : max),
    0
  );

  // Bucket actions by day index (0 = today, 29 = 30 days ago).
  const dayBuckets: Array<ActionEntry[]> = Array.from(
    { length: 30 },
    () => [] as ActionEntry[]
  );
  for (const a of actions) {
    const dayIdx = Math.floor((now - a.timestamp) / DAY_MS);
    if (dayIdx < 0 || dayIdx >= 30) continue;
    dayBuckets[dayIdx]!.push(a);
  }
  const maxDay = Math.max(1, ...dayBuckets.map((arr) => arr.length));

  return (
    <div>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 mb-2">
        <span className="font-semibold text-gray-800 dark:text-gray-200">
          {actions.length}
        </span>{' '}
        action{actions.length === 1 ? '' : 's'} logged
        <span className="text-gray-400 dark:text-gray-500"> · most recent: </span>
        <span className="font-medium text-gray-800 dark:text-gray-200">
          {relativeTime(mostRecent, now)}
        </span>
      </p>

      <div className="relative h-14 rounded-md bg-gray-50 dark:bg-gray-900/60 border border-gray-200/60 dark:border-gray-800/60 overflow-hidden">
        {/* Dashed tick lines at 7d / 14d / 21d for axis context */}
        {TICKS.map((t) => (
          <div
            key={t.label}
            className="absolute top-1 bottom-1 border-l border-dashed border-gray-300/70 dark:border-gray-700/60 pointer-events-none"
            style={{ left: `${t.pct}%` }}
            aria-hidden
          />
        ))}
        {/* 30 day columns, today on right (dayIdx 0), 30d ago on left (dayIdx 29) */}
        <div
          className="absolute inset-1 grid items-end gap-px"
          style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}
        >
          {Array.from({ length: 30 }, (_, i) => 29 - i).map((dayIdx) => {
            const arr = dayBuckets[dayIdx] ?? [];
            if (arr.length === 0) {
              return <div key={dayIdx} className="h-full" aria-hidden />;
            }
            const counts: Record<ActionEntry['action'], number> = {
              approve: 0,
              remove: 0,
              spam: 0,
              ban: 0,
              mute: 0,
            };
            for (const a of arr) counts[a.action] += 1;
            const heightPct = (arr.length / maxDay) * 100;
            const label =
              dayIdx === 0
                ? 'today'
                : dayIdx === 1
                  ? 'yesterday'
                  : `${dayIdx}d ago`;
            const breakdown = ACTION_KINDS.filter((k) => counts[k] > 0)
              .map((k) => `${counts[k]} ${k}`)
              .join(', ');
            return (
              <div
                key={dayIdx}
                className="h-full flex flex-col justify-end"
                title={`${label}: ${arr.length} action${arr.length === 1 ? '' : 's'} (${breakdown})`}
              >
                <div
                  className="w-full flex flex-col rounded-sm overflow-hidden"
                  style={{ height: `${heightPct}%` }}
                >
                  {ACTION_KINDS.map((kind) => {
                    if (counts[kind] === 0) return null;
                    return (
                      <div
                        key={kind}
                        className={ACTION_COLORS[kind]}
                        style={{
                          height: `${(counts[kind] / arr.length) * 100}%`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative mt-1.5 h-3 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="absolute left-0">30 days ago</span>
        {TICKS.map((t) => (
          <span
            key={t.label}
            className="absolute text-gray-400 dark:text-gray-500"
            style={{ left: `${t.pct}%`, transform: 'translateX(-50%)' }}
          >
            {t.label}
          </span>
        ))}
        <span className="absolute right-0">today</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> approved
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> removed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-900 dark:bg-gray-100" /> spam
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-600" /> banned
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> muted
        </span>
      </div>
    </div>
  );
};

const ContextPeekDrawer = ({
  item,
  subredditName,
  onClose,
  onBanned,
}: {
  item: QueueItem;
  subredditName: string;
  onClose: () => void;
  onBanned: () => void;
}) => {
  const itemId = item.itemId;
  const url = redditUrl(item, subredditName);
  const [data, setData] = useState<ContextPeekResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ban-user action state (click-twice confirm pattern, mirrors group bulk)
  const [pendingBan, setPendingBan] = useState(false);
  const [banBusy, setBanBusy] = useState(false);
  const [banError, setBanError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [removedItems, setRemovedItems] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
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
    if (!pendingBan) return;
    const id = setTimeout(() => setPendingBan(false), 3000);
    return () => clearTimeout(id);
  }, [pendingBan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const authorName = data?.authorName ?? item.authorName;
  const gradient = avatarGradient(authorName);

  const handleBan = async () => {
    if (banBusy || banned) return;
    if (!pendingBan) {
      setPendingBan(true);
      return;
    }
    setPendingBan(false);
    setBanBusy(true);
    setBanError(null);
    try {
      const res = await fetch('/api/user-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authorName, action: 'ban' }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(
          (errBody as { message?: string } | null)?.message ??
            `HTTP ${res.status}`
        );
      }
      const data: UserActionResponse = await res.json();
      if (!data.ok) throw new Error('ban returned not-ok');
      setBanned(true);
      setRemovedItems(data.removedItems ?? null);
      // Signal parent so the queue refreshes — items by this user are now
      // gone from Reddit + Redis, and the user is banned from the sub.
      onBanned();
    } catch (err) {
      setBanError(err instanceof Error ? err.message : 'ban failed');
    } finally {
      setBanBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        role="presentation"
      />
      <aside className="w-[380px] max-w-full bg-white dark:bg-gray-950 shadow-2xl overflow-y-auto border-l border-gray-200 dark:border-gray-800 flex flex-col">
        <header className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white/95 dark:bg-gray-950/95 backdrop-blur z-10">
          <div className="flex justify-between items-start gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar
                username={authorName}
                size="sm"
                gradientCls={gradient}
              />
              <div className="min-w-0">
                <h2 className="font-semibold text-sm truncate text-gray-900 dark:text-gray-100">
                  u/{authorName}
                </h2>
                <p className="text-[10px] font-mono text-gray-400 dark:text-gray-500 truncate">
                  {itemId}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
              aria-label="Close drawer"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {url && (
              <button
                onClick={() => navigateTo(url)}
                className="text-orange-600 dark:text-orange-400 hover:underline"
              >
                Open on Reddit
              </button>
            )}
            <button
              onClick={() => navigateTo(profileUrl(authorName))}
              className="text-orange-600 dark:text-orange-400 hover:underline"
            >
              View profile
            </button>
            {banned ? (
              <span className="text-rose-700 dark:text-rose-300 font-semibold">
                Banned
                {typeof removedItems === 'number' && removedItems > 0 && (
                  <span className="ml-1 font-normal text-rose-600/80 dark:text-rose-300/70">
                    · cleaned up {removedItems} item
                    {removedItems === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            ) : (
              <button
                disabled={banBusy}
                onClick={handleBan}
                className={`disabled:opacity-50 hover:underline ${
                  pendingBan
                    ? 'text-rose-700 dark:text-rose-300 font-semibold animate-pulse'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {banBusy
                  ? 'Banning...'
                  : pendingBan
                    ? `Confirm: ban u/${authorName}`
                    : 'Ban user'}
              </button>
            )}
          </div>
          {banError && (
            <p className="mt-1.5 text-[11px] text-rose-700 dark:text-rose-300">
              Ban failed: {banError}
            </p>
          )}
        </header>

        <div className="p-3 sm:p-4 space-y-5 flex-1">
          {error && (
            <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 px-3 py-2 rounded">
              {error}
            </p>
          )}
          {!data && !error && (
            <p className="text-xs text-gray-500">Loading context...</p>
          )}
          {data && (
            <>
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 font-semibold">
                  Facts the AI saw
                </h3>
                <FactsTable facts={data.facts} />
              </section>

              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 font-semibold">
                  Last 5 in this sub
                </h3>
                <RecentList recent={data.recent} />
              </section>

              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 font-semibold">
                  30-day mod action timeline
                </h3>
                <Timeline actions={data.actions} />
              </section>
            </>
          )}
        </div>

        <footer className="px-3 sm:px-4 py-2.5 border-t border-gray-200 dark:border-gray-800 text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50/60 dark:bg-gray-900/60">
          Titles only, never body content. Click <span className="font-medium">Open on Reddit</span> to read full content.
        </footer>
      </aside>
    </div>
  );
};

const EmptyState = () => (
  <div className="text-center py-16 px-4">
    <img
      src="/huddle-logo.svg"
      alt=""
      className="mx-auto mb-4 w-14 h-14 rounded-2xl shadow-md shadow-orange-500/20 opacity-80"
    />
    <p className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
      Modqueue is clear
    </p>
    <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
      Reports will appear here clustered by user, with a one-sentence
      summary on each item.
    </p>
  </div>
);

const App = () => {
  const { groups, subredditName, loading, error, refresh } = useQueue();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusyKey, setBulkBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drawerItem, setDrawerItem] = useState<QueueItem | null>(null);

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
        setActionError(`${data.okCount} ${verb}d, ${data.failCount} failed`);
      }
      if (
        drawerItem &&
        group.items.some((i) => i.itemId === drawerItem.itemId)
      ) {
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
    <div className="min-h-screen bg-gradient-to-b from-white via-white to-orange-50/40 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 text-gray-900 dark:text-gray-100">
      <div className="max-w-3xl mx-auto p-3 sm:p-6">
        <header className="mb-4 sm:mb-5 flex justify-between items-center gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/huddle-logo.svg"
              alt=""
              className="shrink-0 w-9 h-9 rounded-xl shadow-md shadow-orange-500/20 select-none"
            />
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight leading-none">
                Huddle
              </h1>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                the modqueue, with intelligence
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-none whitespace-nowrap">
              {loading ? '—' : itemCount}{' '}
              <span className="text-gray-500 dark:text-gray-400 font-normal">
                {itemCount === 1 ? 'item' : 'items'}
              </span>
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex items-center justify-end gap-1.5 whitespace-nowrap">
              {!loading && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"
                  aria-hidden
                />
              )}
              {loading
                ? 'Loading…'
                : `${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`}
            </p>
          </div>
        </header>

        {(error || actionError) && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-sm border border-rose-200/60 dark:border-rose-800/60">
            {actionError ?? error}
          </div>
        )}

        {!loading && groups.length === 0 && !error && <EmptyState />}

        {groups.length > 0 && (
          <ul className="list-none space-y-3">
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
                onRejected={() => void refresh()}
                onOpenDrawer={setDrawerItem}
              />
            ))}
          </ul>
        )}
      </div>

      {drawerItem && (
        <ContextPeekDrawer
          key={drawerItem.itemId}
          item={drawerItem}
          subredditName={subredditName}
          onClose={() => setDrawerItem(null)}
          onBanned={() => void refresh()}
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
