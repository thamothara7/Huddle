import { redis } from '@devvit/web/server';
import { k, USER_RECENT_CAP } from './keys';

export type RecentEntry = {
  itemId: string;
  title: string;
  status: 'pending' | 'approved' | 'removed' | 'spam';
  createdAt: number;
};

export type ActionEntry = {
  action: 'approve' | 'remove' | 'spam';
  modId: string;
  itemId: string;
  timestamp: number;
};

export const appendRecent = async (
  username: string,
  subId: string,
  entry: RecentEntry
): Promise<void> => {
  const key = k.userRecent(username, subId);
  await redis.zAdd(key, {
    member: JSON.stringify(entry),
    score: entry.createdAt,
  });
  const rows = await redis.zRange(key, 0, -1, { by: 'rank' });
  if (rows.length > USER_RECENT_CAP) {
    const overflow = rows
      .slice(0, rows.length - USER_RECENT_CAP)
      .map((r) => r.member);
    await redis.zRem(key, overflow);
  }
};

export const updateRecentStatus = async (
  username: string,
  subId: string,
  itemId: string,
  status: RecentEntry['status']
): Promise<void> => {
  const key = k.userRecent(username, subId);
  const rows = await redis.zRange(key, 0, -1, { by: 'rank' });
  for (const row of rows) {
    const entry = JSON.parse(row.member) as RecentEntry;
    if (entry.itemId === itemId) {
      const updated: RecentEntry = { ...entry, status };
      await redis.zRem(key, [row.member]);
      await redis.zAdd(key, {
        member: JSON.stringify(updated),
        score: row.score,
      });
      return;
    }
  }
};

export const getRecentTitles = async (
  username: string,
  subId: string,
  limit = 5
): Promise<RecentEntry[]> => {
  const rows = await redis.zRange(k.userRecent(username, subId), 0, -1, {
    by: 'rank',
    reverse: true,
  });
  return rows
    .slice(0, limit)
    .map((r) => JSON.parse(r.member) as RecentEntry);
};

export const appendAction = async (
  username: string,
  subId: string,
  entry: ActionEntry
): Promise<void> => {
  await redis.zAdd(k.userActions(username, subId), {
    member: JSON.stringify(entry),
    score: entry.timestamp,
  });
};

export const getActionTimeline = async (
  username: string,
  subId: string,
  windowMs = 30 * 24 * 60 * 60 * 1000
): Promise<ActionEntry[]> => {
  const cutoff = Date.now() - windowMs;
  const rows = await redis.zRange(k.userActions(username, subId), cutoff, '+inf', {
    by: 'score',
  });
  return rows.map((r) => JSON.parse(r.member) as ActionEntry);
};
