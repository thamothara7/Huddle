import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import { fetchGroupedQueue } from '../core/queue';
import { getItem, getItems, setItem } from '../core/items';
import { listOpenItemIds, removeItemFromAllGroups } from '../core/groups';
import { isThingId, isUserId } from '../core/ids';
import { computeUserFacts } from '../core/ai/facts';
import { generateRemovalReason } from '../core/ai/reason';
import { getOrGenerateSuggestion } from '../core/ai/suggest';
import { getOrGenerateSummary } from '../core/ai/summary';
import { getActionTimeline, getRecentTitles } from '../core/history';
import { k, USER_SNOOVATAR_TTL_SECONDS } from '../core/keys';
import type {
  ActionRequest,
  ActionResponse,
  BulkActionRequest,
  BulkActionResponse,
  BulkActionResult,
  ContextPeekResponse,
  InitResponse,
  RejectWithReasonRequest,
  RejectWithReasonResponse,
  SnoovatarResponse,
  SuggestionResponse,
  SuggestReasonResponse,
  SummaryResponse,
  UserActionRequest,
  UserActionResponse,
} from '../../shared/api';

type ErrorResponse = { status: 'error'; message: string };

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId, subredditId, subredditName } = context;
  if (!postId || !subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'missing postId or subredditId in context' },
      400
    );
  }
  const [username, groups] = await Promise.all([
    reddit.getCurrentUsername(),
    fetchGroupedQueue(subredditId),
  ]);
  return c.json<InitResponse>({
    type: 'init',
    postId,
    subredditName: subredditName ?? '',
    username: username ?? 'anonymous',
    groups,
  });
});

const SNOOVATAR_CACHE_MISS = 'none';
const SNOOVATAR_MISS_TTL_SECONDS = 5 * 60; // re-fetch quickly when API returned nothing
const SNOOVATAR_HIT_TTL_SECONDS = USER_SNOOVATAR_TTL_SECONDS; // 24h for real URLs

// Devvit's reddit.getSnoovatarUrl ONLY returns the customized snoovatar
// from reddit.com/avatar — it does not surface the user's general profile
// icon (default snoo or uploaded image). For accounts that never built a
// custom snoovatar, that call returns undefined even though every Reddit
// account has at minimum a default snoo at /user/{name}/about.json's
// icon_img field. Fetch that as a fallback so every user gets an avatar.
//
// reddit.com is implicit in Devvit's http allowlist per the devvit.json
// schema description ("reddit.com or subdomains should not be included"),
// so this fetch does not require a domain entry in permissions.http.domains.
const fetchRedditUserAvatar = async (
  username: string
): Promise<string | null> => {
  try {
    const res = await fetch(
      `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`,
      { headers: { 'User-Agent': 'huddle-devvit-app/0.1 (avatar fallback)' } }
    );
    if (!res.ok) {
      console.warn(
        `[huddle] reddit about.json for ${username}: HTTP ${res.status}`
      );
      return null;
    }
    const json = (await res.json()) as {
      data?: { snoovatar_img?: string; icon_img?: string };
    };
    const snoo = json?.data?.snoovatar_img;
    const icon = json?.data?.icon_img;
    // Reddit serializes ampersands as &amp; in JSON sometimes; normalize.
    const clean = (s: string): string => s.replace(/&amp;/g, '&');
    if (typeof snoo === 'string' && snoo.startsWith('http')) {
      return clean(snoo);
    }
    if (typeof icon === 'string' && icon.startsWith('http')) {
      return clean(icon);
    }
    return null;
  } catch (err) {
    console.error(
      `[huddle] reddit about.json fetch threw for ${username}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
};

api.get('/snoovatar', async (c) => {
  const username = c.req.query('username')?.trim();
  const refresh = c.req.query('refresh') === '1';
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'missing username' },
      400
    );
  }
  const cacheKey = k.userSnoovatar(username);

  if (!refresh) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(
        `[huddle] /api/snoovatar ${username} cache hit: ${cached === SNOOVATAR_CACHE_MISS ? 'NONE' : cached.slice(0, 80)}`
      );
      return c.json<SnoovatarResponse>({
        type: 'snoovatar',
        username,
        url: cached === SNOOVATAR_CACHE_MISS ? null : cached,
      });
    }
  } else {
    console.log(`[huddle] /api/snoovatar ${username} refresh=1 bypassing cache`);
    try {
      await redis.del(cacheKey);
    } catch {
      // ignore
    }
  }

  let url: string | null = null;
  let source: 'snoovatar' | 'aboutjson' | 'none' = 'none';
  try {
    const snoo = await reddit.getSnoovatarUrl(username);
    if (typeof snoo === 'string' && snoo.length > 0) {
      url = snoo;
      source = 'snoovatar';
    }
  } catch (err) {
    console.error(
      `[huddle] /api/snoovatar getSnoovatarUrl threw for ${username}:`,
      err instanceof Error ? err.message : err
    );
  }
  // Devvit's API only knows about customized snoovatars. For everyone else
  // (including default-snoo users), pull icon_img / snoovatar_img from
  // Reddit's public /about.json.
  if (!url) {
    const fallback = await fetchRedditUserAvatar(username);
    if (fallback) {
      url = fallback;
      source = 'aboutjson';
    }
  }

  const ttl = url ? SNOOVATAR_HIT_TTL_SECONDS : SNOOVATAR_MISS_TTL_SECONDS;
  console.log(
    `[huddle] /api/snoovatar ${username} resolved: source=${source} url=${url ? JSON.stringify(url.slice(0, 100)) : 'NONE'} cacheTtl=${ttl}s`
  );
  try {
    await redis.set(cacheKey, url ?? SNOOVATAR_CACHE_MISS, {
      expiration: new Date(Date.now() + ttl * 1000),
    });
  } catch {
    // best-effort cache write; ignore failures
  }
  return c.json<SnoovatarResponse>({ type: 'snoovatar', username, url });
});

api.get('/summary', async (c) => {
  const { subredditId } = context;
  const itemId = c.req.query('itemId');
  if (!itemId || !subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'missing itemId or context' },
      400
    );
  }
  if (!isThingId(itemId)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `not a post or comment id: ${itemId}` },
      400
    );
  }
  const item = await getItem(itemId);
  if (!item) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `item ${itemId} not found` },
      404
    );
  }
  if (item.subId !== subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'item is not in this subreddit' },
      403
    );
  }
  const facts = await computeUserFacts(item.authorName, subredditId);
  const result = await getOrGenerateSummary(itemId, facts);
  console.log(
    `[huddle] /api/summary itemId=${itemId} source=${result.source} len=${result.text.length} preview=${JSON.stringify(result.text.slice(0, 80))}`
  );
  return c.json<SummaryResponse>({
    type: 'summary',
    itemId,
    summary: result.text,
    source: result.source,
  });
});

api.get('/context-peek', async (c) => {
  const { subredditId } = context;
  const itemId = c.req.query('itemId');
  if (!itemId || !subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'missing itemId or context' },
      400
    );
  }
  if (!isThingId(itemId)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `not a post or comment id: ${itemId}` },
      400
    );
  }
  const item = await getItem(itemId);
  if (!item) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `item ${itemId} not found` },
      404
    );
  }
  if (item.subId !== subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'item is not in this subreddit' },
      403
    );
  }
  const [facts, recent, actions] = await Promise.all([
    computeUserFacts(item.authorName, subredditId),
    getRecentTitles(item.authorName, subredditId, 5),
    getActionTimeline(item.authorName, subredditId),
  ]);
  return c.json<ContextPeekResponse>({
    type: 'context-peek',
    itemId,
    authorName: item.authorName,
    facts,
    recent,
    actions,
  });
});

const performAction = async (
  itemId: `t3_${string}` | `t1_${string}`,
  action: 'approve' | 'remove',
  username: string | undefined
): Promise<void> => {
  const item = await getItem(itemId);
  if (!item) throw new Error(`item ${itemId} not found`);
  if (action === 'approve') {
    await reddit.approve(itemId);
  } else {
    await reddit.remove(itemId, false);
  }
  await setItem({
    ...item,
    status: 'actioned',
    actionedBy: username ?? undefined,
    actionTaken: action,
  });
  await removeItemFromAllGroups(item.subId, item.itemId);
};

api.post('/action', async (c) => {
  const body = await c.req.json<ActionRequest>();
  if (!body.itemId || (body.action !== 'approve' && body.action !== 'remove')) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'invalid request' },
      400
    );
  }
  if (!isThingId(body.itemId)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `not a post or comment id: ${body.itemId}` },
      400
    );
  }
  try {
    const username = await reddit.getCurrentUsername();
    await performAction(body.itemId, body.action, username);
    return c.json<ActionResponse>({
      type: 'action',
      itemId: body.itemId,
      action: body.action,
      ok: true,
    });
  } catch (error) {
    console.error('action failed:', error);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'action failed',
      },
      500
    );
  }
});

api.post('/action-bulk', async (c) => {
  const body = await c.req.json<BulkActionRequest>();
  if (
    !Array.isArray(body.itemIds) ||
    body.itemIds.length === 0 ||
    (body.action !== 'approve' && body.action !== 'remove')
  ) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'invalid request' },
      400
    );
  }
  const username = await reddit.getCurrentUsername();
  const results: BulkActionResult[] = [];
  for (const id of body.itemIds) {
    if (!isThingId(id)) {
      results.push({ itemId: id, ok: false, error: 'invalid id' });
      continue;
    }
    try {
      await performAction(id, body.action, username);
      results.push({ itemId: id, ok: true });
    } catch (error) {
      console.error(`bulk action failed for ${id}:`, error);
      results.push({
        itemId: id,
        ok: false,
        error: error instanceof Error ? error.message : 'action failed',
      });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  return c.json<BulkActionResponse>({
    type: 'action-bulk',
    action: body.action,
    results,
    okCount,
    failCount: results.length - okCount,
  });
});

api.get('/suggestion', async (c) => {
  const { subredditId } = context;
  const itemId = c.req.query('itemId');
  if (!itemId || !subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'missing itemId or context' },
      400
    );
  }
  if (!isThingId(itemId)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `not a post or comment id: ${itemId}` },
      400
    );
  }
  const item = await getItem(itemId);
  if (!item) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `item ${itemId} not found` },
      404
    );
  }
  if (item.subId !== subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'item is not in this subreddit' },
      403
    );
  }
  const facts = await computeUserFacts(item.authorName, subredditId);
  const suggestion = await getOrGenerateSuggestion(itemId, {
    itemType: item.type,
    userReportReasons: item.reportReasons,
    modReportReasons: (item.modReports ?? []).map((m) => m.reason),
    accountAgeDays: facts.accountAgeDays,
    postsInSubTotal: facts.postsInSubTotal,
    commentsInSubTotal: facts.commentsInSubTotal,
    inSubLast7d: facts.inSubLast7d,
    priorRemovals: facts.removedInSubTotal,
  });
  return c.json<SuggestionResponse>({
    type: 'suggestion',
    itemId,
    suggestion,
  });
});

api.get('/suggest-reason', async (c) => {
  const { subredditId } = context;
  const itemId = c.req.query('itemId');
  if (!itemId || !subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'missing itemId or context' },
      400
    );
  }
  if (!isThingId(itemId)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `not a post or comment id: ${itemId}` },
      400
    );
  }
  const item = await getItem(itemId);
  if (!item) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `item ${itemId} not found` },
      404
    );
  }
  if (item.subId !== subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'item is not in this subreddit' },
      403
    );
  }
  const facts = await computeUserFacts(item.authorName, subredditId);
  const reason = await generateRemovalReason({
    itemType: item.type,
    title: item.title,
    userReportReasons: item.reportReasons,
    modReportReasons: (item.modReports ?? []).map((m) => m.reason),
    accountAgeDays: facts.accountAgeDays,
    priorRemovals: facts.removedInSubTotal,
  });
  if (!reason) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message:
          'Could not generate a reason. Either no Gemini key is configured or the model returned an empty response. Type your own reason instead.',
      },
      503
    );
  }
  return c.json<SuggestReasonResponse>({
    type: 'suggest-reason',
    itemId,
    reason,
  });
});

api.post('/reject-with-reason', async (c) => {
  const body = await c.req.json<RejectWithReasonRequest>();
  const { subredditId } = context;
  const trimmed = (body.reason ?? '').trim();
  if (!body.itemId || !subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'missing itemId or context' },
      400
    );
  }
  if (!isThingId(body.itemId)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `not a post or comment id: ${body.itemId}` },
      400
    );
  }
  if (trimmed.length < 10) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'reason must be at least 10 characters' },
      400
    );
  }
  const item = await getItem(body.itemId);
  if (!item) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `item ${body.itemId} not found` },
      404
    );
  }
  if (item.subId !== subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'item is not in this subreddit' },
      403
    );
  }

  try {
    const username = await reddit.getCurrentUsername();

    // 1. Remove the item from Reddit
    await reddit.remove(body.itemId, false);

    // 2. Post the reason as a distinguished + stickied reply.
    //    submitComment accepts both t3_ (post) and t1_ (comment) ids — for
    //    posts the reply is top-level, for comments it nests under the comment.
    let commentId: string | undefined;
    try {
      const reply = await reddit.submitComment({
        id: body.itemId,
        text: trimmed,
      });
      commentId = reply.id;
      try {
        await reply.distinguish(true);
      } catch (distinguishErr) {
        console.warn(
          '[huddle] reject-with-reason: distinguish/sticky failed:',
          distinguishErr instanceof Error
            ? distinguishErr.message
            : distinguishErr
        );
      }
    } catch (commentErr) {
      console.error(
        '[huddle] reject-with-reason: posting reason comment failed:',
        commentErr instanceof Error ? commentErr.message : commentErr
      );
      // Removal already succeeded — proceed to mark actioned even if the
      // reason comment didn't post. Surface in the response.
    }

    // 3. Update local state
    await setItem({
      ...item,
      status: 'actioned',
      actionedBy: username ?? undefined,
      actionTaken: 'remove',
    });
    await removeItemFromAllGroups(item.subId, item.itemId);

    console.log(
      `[huddle] /api/reject-with-reason ${body.itemId} ok (commentId=${commentId ?? 'none'})`
    );
    return c.json<RejectWithReasonResponse>({
      type: 'reject-with-reason',
      itemId: body.itemId,
      ok: true,
      commentId,
    });
  } catch (error) {
    console.error('[huddle] /api/reject-with-reason failed:', error);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'rejection failed',
      },
      500
    );
  }
});

const VALID_USER_ACTIONS = new Set(['ban', 'unban', 'mute', 'unmute']);

// reddit.banUser / muteUser expect a username (string like 'karthikvelan1'),
// not a t2_ thing-id. Early in an item's life its authorName is stored as
// the t2_ fallback until we can resolve the real handle, so the drawer can
// end up sending us the id. Look it up via getUserById and return the
// canonical username.
const resolveUsername = async (raw: string): Promise<string | null> => {
  if (!raw) return null;
  if (!isUserId(raw)) return raw; // already a username
  try {
    const user = await reddit.getUserById(raw);
    return user?.username ?? null;
  } catch (err) {
    console.error(
      `[huddle] resolveUsername(${raw}) failed:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
};

api.post('/user-action', async (c) => {
  const body = await c.req.json<UserActionRequest>();
  const { subredditName, subredditId } = context;
  if (!body.username || !subredditName || !subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'missing username or subreddit context' },
      400
    );
  }
  if (!VALID_USER_ACTIONS.has(body.action)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `invalid action: ${body.action}` },
      400
    );
  }
  const username = await resolveUsername(body.username);
  if (!username) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: `could not resolve username from "${body.username}"`,
      },
      400
    );
  }
  const reason = body.reason || 'Actioned via Huddle';
  let removedItems: number | undefined;
  try {
    switch (body.action) {
      case 'ban':
        await reddit.banUser({
          username,
          subredditName,
          reason,
          note: 'Banned via Huddle',
        });
        // Cascade-remove every queued item this user authored — banning
        // implies their reported content shouldn't sit in the queue
        // anymore. We compare against item.authorName so this catches both
        // post groups (keyed by t2_) and comment groups (keyed by username).
        removedItems = await cascadeRemoveByAuthor(subredditId, username);
        break;
      case 'unban':
        await reddit.unbanUser(username, subredditName);
        break;
      case 'mute':
        await reddit.muteUser({
          username,
          subredditName,
          note: 'Muted via Huddle',
        });
        break;
      case 'unmute':
        await reddit.unmuteUser(username, subredditName);
        break;
    }
    console.log(
      `[huddle] /api/user-action ${body.action} u/${username} ok${typeof removedItems === 'number' ? ` (cascade-removed ${removedItems} items)` : ''}`
    );
    return c.json<UserActionResponse>({
      type: 'user-action',
      username,
      action: body.action,
      ok: true,
      removedItems,
    });
  } catch (error) {
    console.error(
      `[huddle] /api/user-action ${body.action} u/${username} failed:`,
      error instanceof Error ? error.message : error
    );
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'user action failed',
      },
      500
    );
  }
});

// Helper: after a ban, sweep every open queue item authored by this user.
// Returns the count of successful removals so the client can show
// 'Banned · cleaned up N items'. Failures on individual items are logged
// but don't fail the whole sweep.
const cascadeRemoveByAuthor = async (
  subredditId: string,
  username: string
): Promise<number> => {
  const ids = await listOpenItemIds(subredditId);
  if (ids.length === 0) return 0;
  const items = await getItems(ids);
  const userItems = items.filter(
    (i) => i.status === 'open' && i.authorName === username
  );
  let removed = 0;
  const actorName = (await reddit.getCurrentUsername()) ?? undefined;
  for (const item of userItems) {
    try {
      if (isThingId(item.itemId)) {
        await reddit.remove(item.itemId, false);
      }
      await setItem({
        ...item,
        status: 'actioned',
        actionedBy: actorName,
        actionTaken: 'remove',
      });
      await removeItemFromAllGroups(item.subId, item.itemId);
      removed += 1;
    } catch (err) {
      console.error(
        `[huddle] cascadeRemove ${item.itemId} for u/${username} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return removed;
};
