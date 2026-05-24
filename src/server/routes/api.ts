import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { fetchGroupedQueue } from '../core/queue';
import { getItem, setItem } from '../core/items';
import { removeItemFromAllGroups } from '../core/groups';
import { isThingId } from '../core/ids';
import { computeUserFacts } from '../core/ai/facts';
import { getOrGenerateSummary } from '../core/ai/summary';
import { getActionTimeline, getRecentTitles } from '../core/history';
import type {
  ActionRequest,
  ActionResponse,
  BulkActionRequest,
  BulkActionResponse,
  BulkActionResult,
  ContextPeekResponse,
  InitResponse,
  SummaryResponse,
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

api.get('/summary', async (c) => {
  const { subredditId } = context;
  const itemId = c.req.query('itemId');
  if (!itemId || !subredditId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'missing itemId or context' },
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
  const item = await getItem(itemId);
  if (!item) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `item ${itemId} not found` },
      404
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
