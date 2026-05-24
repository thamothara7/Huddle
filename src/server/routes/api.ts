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
  ContextPeekResponse,
  InitResponse,
  SummaryResponse,
} from '../../shared/api';

type ErrorResponse = { status: 'error'; message: string };

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId, subredditId } = context;
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
  const summary = await getOrGenerateSummary(itemId, facts);
  return c.json<SummaryResponse>({ type: 'summary', itemId, summary });
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
  const item = await getItem(body.itemId);
  if (!item) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `item ${body.itemId} not found` },
      404
    );
  }
  try {
    if (body.action === 'approve') {
      await reddit.approve(body.itemId);
    } else {
      await reddit.remove(body.itemId, false);
    }
    const username = await reddit.getCurrentUsername();
    const updated = {
      ...item,
      status: 'actioned' as const,
      actionedBy: username ?? undefined,
      actionTaken: body.action,
    };
    await setItem(updated);
    await removeItemFromAllGroups(item.subId, item.itemId);
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
