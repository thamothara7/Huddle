import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnCommentReportRequest,
  OnCommentSubmitRequest,
  OnModActionRequest,
  OnPostReportRequest,
  OnPostSubmitRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { context, reddit } from '@devvit/web/server';
import { createPost } from '../core/post';
import { getItem, setItem, upsertReport } from '../core/items';
import { addItemToGroups, removeItemFromAllGroups } from '../core/groups';
import { isUserId } from '../core/ids';
import {
  appendAction,
  appendRecent,
  updateRecentStatus,
} from '../core/history';
import type { QueueItem } from '../../shared/api';

export const triggers = new Hono();

const CLOSING_ACTIONS = new Set([
  'approvelink',
  'removelink',
  'spamlink',
  'approvecomment',
  'removecomment',
  'spamcomment',
]);

const resolveAuthorName = async (
  authorId: string,
  fallback: string
): Promise<string> => {
  if (!isUserId(authorId)) return fallback;
  try {
    const user = await reddit.getUserById(authorId);
    return user?.username ?? fallback;
  } catch {
    return fallback;
  }
};

triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createPost();
    const input = await c.req.json<OnAppInstallRequest>();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Huddle installed in r/${context.subredditName} (post ${post.id}, trigger ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`on-app-install error: ${error}`);
    return c.json<TriggerResponse>(
      { status: 'error', message: 'Failed to create Huddle post' },
      400
    );
  }
});

triggers.post('/on-post-report', async (c) => {
  const input = await c.req.json<OnPostReportRequest>();
  const post = input.post;
  const subId = context.subredditId;
  if (!post?.id || !post.authorId || !subId) {
    return c.json<TriggerResponse>({}, 200);
  }
  const now = Date.now();
  const item = await upsertReport(
    post.id,
    () => ({
      itemId: post.id,
      type: 'post',
      subId,
      authorId: post.authorId,
      authorName: post.authorId,
      title: post.title,
      reportReasons: [],
      reportCount: 1,
      createdAt: now,
      status: 'open',
    }),
    input.reason
  );
  if (item.authorName === item.authorId) {
    item.authorName = await resolveAuthorName(item.authorId, item.authorId);
    await setItem(item);
  }
  await addItemToGroups(subId, item.itemId, item.authorId, now);
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-comment-report', async (c) => {
  const input = await c.req.json<OnCommentReportRequest>();
  const comment = input.comment;
  const subId = context.subredditId;
  if (!comment?.id || !subId) {
    return c.json<TriggerResponse>({}, 200);
  }
  const authorName = comment.author || 'unknown';
  const now = Date.now();
  const item = await upsertReport(
    comment.id,
    () => ({
      itemId: comment.id,
      type: 'comment',
      subId,
      authorId: authorName,
      authorName,
      parentPostId: comment.postId,
      reportReasons: [],
      reportCount: 1,
      createdAt: now,
      status: 'open',
    }),
    input.reason
  );
  await addItemToGroups(subId, item.itemId, item.authorId, now);
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-mod-action', async (c) => {
  const input = await c.req.json<OnModActionRequest>();
  const action = input.action ?? '';
  if (!CLOSING_ACTIONS.has(action)) {
    return c.json<TriggerResponse>({}, 200);
  }
  const targetId = input.targetPost?.id ?? input.targetComment?.id;
  if (!targetId) return c.json<TriggerResponse>({}, 200);

  const actionKind: 'approve' | 'remove' | 'spam' = action.startsWith('approve')
    ? 'approve'
    : action.startsWith('spam')
      ? 'spam'
      : 'remove';
  const recentStatus =
    actionKind === 'approve' ? 'approved' : actionKind === 'spam' ? 'spam' : 'removed';

  const existing = await getItem(targetId);
  if (existing) {
    if (existing.status === 'open') {
      const updated: QueueItem = {
        ...existing,
        status: 'actioned',
        actionedBy: input.moderator?.name,
        actionTaken: actionKind,
      };
      await setItem(updated);
      await removeItemFromAllGroups(updated.subId, updated.itemId);
    }
    await Promise.all([
      appendAction(existing.authorName, existing.subId, {
        action: actionKind,
        modId: input.moderator?.name ?? 'unknown',
        itemId: targetId,
        timestamp: Date.now(),
      }),
      updateRecentStatus(existing.authorName, existing.subId, targetId, recentStatus),
    ]);
  }
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-post-submit', async (c) => {
  const input = await c.req.json<OnPostSubmitRequest>();
  const post = input.post;
  const author = input.author;
  const subId = context.subredditId;
  if (!post?.id || !author?.name || !subId) {
    return c.json<TriggerResponse>({}, 200);
  }
  await appendRecent(author.name, subId, {
    itemId: post.id,
    title: post.title ?? '(no title)',
    status: 'pending',
    createdAt: Date.now(),
  });
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-comment-submit', async (c) => {
  const input = await c.req.json<OnCommentSubmitRequest>();
  const comment = input.comment;
  const author = input.author;
  const subId = context.subredditId;
  if (!comment?.id || !author?.name || !subId) {
    return c.json<TriggerResponse>({}, 200);
  }
  const snippet =
    (comment.body ?? '').slice(0, 80).replace(/\s+/g, ' ').trim() ||
    '(comment)';
  await appendRecent(author.name, subId, {
    itemId: comment.id,
    title: snippet,
    status: 'pending',
    createdAt: Date.now(),
  });
  return c.json<TriggerResponse>({}, 200);
});
