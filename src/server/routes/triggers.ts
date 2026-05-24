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
import { isCommentId, isUserId } from '../core/ids';
import {
  appendAction,
  appendRecent,
  updateRecentStatus,
} from '../core/history';
import { fetchReportsSnapshot } from '../core/reports';
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

const USER_LEVEL_ACTIONS: Record<string, 'ban' | 'mute'> = {
  banuser: 'ban',
  muteuser: 'mute',
};

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

const syncReportsFromApi = async (item: QueueItem): Promise<QueueItem> => {
  const snap = await fetchReportsSnapshot(item.itemId);
  if (!snap) return item;
  // Merge rather than overwrite: when a brand-new report fires this trigger,
  // Reddit's userReportReasons on the Post/Comment hasn't always propagated
  // yet, so the snapshot can return [] even though the user just submitted a
  // reason. Union with the existing in-Redis reasons (dedup) so the trigger-
  // fed reason isn't silently clobbered. Mod reports stay authoritative from
  // the snapshot since triggers never deliver mod-report metadata to us.
  const mergedUserReports = Array.from(
    new Set([...item.reportReasons, ...snap.userReports])
  );
  const apiTotal = snap.userReports.length + snap.modReports.length;
  const merged: QueueItem = {
    ...item,
    reportReasons: mergedUserReports,
    modReports: snap.modReports,
    reportCount: Math.max(apiTotal, mergedUserReports.length, item.reportCount),
  };
  await setItem(merged);
  return merged;
};

triggers.post('/on-post-report', async (c) => {
  const input = await c.req.json<OnPostReportRequest>();
  const post = input.post;
  const subId = context.subredditId;
  if (!post?.id || !post.authorId || !subId) {
    return c.json<TriggerResponse>({}, 200);
  }
  const now = Date.now();
  let item = await upsertReport(
    post.id,
    () => ({
      itemId: post.id,
      type: 'post',
      subId,
      authorId: post.authorId,
      authorName: post.authorId,
      title: post.title,
      permalink: post.permalink,
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
  item = await syncReportsFromApi(item);
  await addItemToGroups(subId, item.itemId, item.authorId, now);
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-comment-report', async (c) => {
  const input = await c.req.json<OnCommentReportRequest>();
  const comment = input.comment;
  const subId = context.subredditId;
  if (!comment?.id || !subId || !isCommentId(comment.id)) {
    return c.json<TriggerResponse>({}, 200);
  }
  const fallbackName = comment.author || 'unknown';

  // The CommentReport trigger payload exposes only the author username — not a
  // t2_ user id. Fetch the full Comment model so we group by the same authorId
  // as posts (otherwise the same user's comments and posts split into two
  // groups with different keys).
  let authorId: string = fallbackName;
  let authorName: string = fallbackName;
  try {
    const fetched = await reddit.getCommentById(comment.id);
    authorId = fetched.authorId ?? fallbackName;
    authorName = fetched.authorName ?? fallbackName;
  } catch (err) {
    console.error(
      `[huddle] on-comment-report: getCommentById failed for ${comment.id}:`,
      err instanceof Error ? err.message : err
    );
  }

  const now = Date.now();
  let item = await upsertReport(
    comment.id,
    () => ({
      itemId: comment.id,
      type: 'comment',
      subId,
      authorId,
      authorName,
      parentPostId: comment.postId,
      permalink: comment.permalink,
      reportReasons: [],
      reportCount: 1,
      createdAt: now,
      status: 'open',
    }),
    input.reason
  );
  item = await syncReportsFromApi(item);
  await addItemToGroups(subId, item.itemId, item.authorId, now);
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-mod-action', async (c) => {
  const input = await c.req.json<OnModActionRequest>();
  const action = input.action ?? '';
  const subId = context.subredditId;
  const modName = input.moderator?.name ?? 'unknown';
  const now = Date.now();

  // Branch 1: user-level actions (ban / mute) — timeline-only, no queue-item cleanup.
  const userLevelKind = USER_LEVEL_ACTIONS[action];
  if (userLevelKind) {
    const targetName = input.targetUser?.name;
    if (subId && targetName) {
      await appendAction(targetName, subId, {
        action: userLevelKind,
        modId: modName,
        itemId: input.targetUser?.id ?? targetName,
        timestamp: now,
      });
    }
    return c.json<TriggerResponse>({}, 200);
  }

  // Branch 2: item-closing actions (approve / remove / spam) — full cleanup.
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
        modId: modName,
        itemId: targetId,
        timestamp: now,
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
