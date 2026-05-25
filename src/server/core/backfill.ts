import { reddit, redis } from '@devvit/web/server';
import { setItem } from './items';
import { addItemToGroups } from './groups';
import { k } from './keys';
import type { ModReportEntry, QueueItem } from '../../shared/api';

const BACKFILL_LIMIT = 100; // Devvit's modqueue API caps at 100 per page
const BACKFILL_DONE_VALUE = '1';

// Reddit's raw modReportReasons surface here is the same shape we already
// normalize from the report-triggers code path — keep parity rather than
// reach into that helper since the call site differs (Post/Comment instance
// vs. trigger payload).
const normalizeUserReport = (raw: unknown): string =>
  typeof raw === 'string' ? raw : String(raw ?? '');

const normalizeModReport = (raw: unknown): ModReportEntry => {
  if (typeof raw === 'string') return { reason: raw };
  if (Array.isArray(raw) && raw.length >= 1) {
    const reason = typeof raw[0] === 'string' ? raw[0] : String(raw[0] ?? '');
    const modName =
      raw.length >= 2 && typeof raw[1] === 'string' && raw[1].length > 0
        ? raw[1]
        : undefined;
    return modName ? { reason, modName } : { reason };
  }
  return { reason: String(raw ?? '') };
};

/**
 * One-time walk of the existing modqueue at install. Reddit's triggers only
 * fire for events after install; without this sweep, items reported before the
 * app was installed would never enter Huddle's queue. Idempotent — a Redis
 * sentinel key guards against re-runs (so it's safe to call from /api/init
 * as a fallback in case the AppInstall trigger missed for some reason).
 */
export const backfillModqueue = async (
  subId: string
): Promise<{ skipped: boolean; count: number }> => {
  const sentinel = await redis.get(k.backfillDone(subId));
  if (sentinel === BACKFILL_DONE_VALUE) {
    return { skipped: true, count: 0 };
  }

  let count = 0;
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const listing = subreddit.getModQueue({ type: 'all', limit: BACKFILL_LIMIT });
    const items = await listing.all();

    for (const it of items) {
      // Branch by structural detection — Post has `title`, Comment has `postId`
      // but not `title`. Both surfaces have id/authorId/permalink.
      const isPost = 'title' in it && typeof (it as { title: unknown }).title === 'string';
      const id = it.id;
      const authorId = it.authorId;
      if (!id || !authorId) continue; // skip orphaned / deleted-author entries

      const userReports = (it.userReportReasons ?? []).map(normalizeUserReport);
      const modReports = (it.modReportReasons ?? []).map(normalizeModReport);
      const reportCount = Math.max(1, userReports.length + modReports.length);
      const createdAt = it.createdAt instanceof Date ? it.createdAt.getTime() : Date.now();

      const item: QueueItem = isPost
        ? {
            itemId: id,
            type: 'post',
            subId,
            authorId,
            authorName: it.authorName ?? authorId,
            title: (it as { title?: string }).title,
            permalink: it.permalink,
            reportReasons: userReports,
            modReports,
            reportCount,
            createdAt,
            status: 'open',
          }
        : {
            itemId: id,
            type: 'comment',
            subId,
            authorId,
            authorName: it.authorName ?? authorId,
            parentPostId: (it as { postId?: string }).postId,
            permalink: it.permalink,
            reportReasons: userReports,
            modReports,
            reportCount,
            createdAt,
            status: 'open',
          };

      await setItem(item);
      await addItemToGroups(subId, item.itemId, item.authorId, createdAt);
      count += 1;
    }

    await redis.set(k.backfillDone(subId), BACKFILL_DONE_VALUE);
    console.log(`[huddle] backfill complete for sub ${subId}: ${count} items`);
  } catch (err) {
    console.error(
      `[huddle] backfill failed for sub ${subId}:`,
      err instanceof Error ? err.message : err
    );
    // Don't set the sentinel — we'll retry on the next /api/init.
  }

  return { skipped: false, count };
};
