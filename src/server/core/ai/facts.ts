import { reddit, redis } from '@devvit/web/server';
import { k, USER_STATS_TTL_SECONDS } from '../keys';

export type UserFacts = {
  accountAgeDays: number;
  postsInSubTotal: number;
  commentsInSubTotal: number;
  inSubLast7d: number;
  removedInSubTotal: number;
};

export const computeUserFacts = async (
  username: string,
  subId: string
): Promise<UserFacts> => {
  const cached = await redis.get(k.userStats(username));
  if (cached) return JSON.parse(cached) as UserFacts;

  const facts: UserFacts = {
    accountAgeDays: 0,
    postsInSubTotal: 0,
    commentsInSubTotal: 0,
    inSubLast7d: 0,
    removedInSubTotal: 0,
  };

  try {
    const user = await reddit.getUserByUsername(username);
    if (user) {
      facts.accountAgeDays = Math.floor(
        (Date.now() - user.createdAt.getTime()) / 86_400_000
      );
    }
  } catch (err) {
    console.error('facts: getUserByUsername failed', err);
  }

  try {
    const items = await reddit
      .getCommentsAndPostsByUser({ username, limit: 100, sort: 'new' })
      .all();
    const cutoff7d = Date.now() - 7 * 86_400_000;
    for (const it of items) {
      if (it.subredditId !== subId) continue;
      const isComment =
        'body' in it && typeof (it as { body?: unknown }).body === 'string';
      if (isComment) facts.commentsInSubTotal += 1;
      else facts.postsInSubTotal += 1;
      if (it.createdAt.getTime() > cutoff7d) facts.inSubLast7d += 1;
      if (it.removed || it.spam) facts.removedInSubTotal += 1;
    }
  } catch (err) {
    console.error('facts: getCommentsAndPostsByUser failed', err);
  }

  try {
    await redis.set(k.userStats(username), JSON.stringify(facts), {
      expiration: new Date(Date.now() + USER_STATS_TTL_SECONDS * 1000),
    });
  } catch (err) {
    console.error('facts: cache write failed', err);
  }
  return facts;
};

export const factsAsRawSentence = (facts: UserFacts): string => {
  const parts: string[] = [];
  if (facts.accountAgeDays > 0) {
    parts.push(`Account ${formatDays(facts.accountAgeDays)} old`);
  }
  const inSub = facts.postsInSubTotal + facts.commentsInSubTotal;
  if (inSub > 0) {
    parts.push(`${inSub} prior item${inSub === 1 ? '' : 's'} in this sub`);
  }
  if (facts.inSubLast7d > 0) {
    parts.push(`${facts.inSubLast7d} in the last 7 days`);
  }
  if (facts.removedInSubTotal > 0) {
    parts.push(
      `${facts.removedInSubTotal} previously removed`
    );
  }
  return parts.length === 0 ? 'No prior activity observed.' : parts.join(', ') + '.';
};

const formatDays = (days: number): string => {
  if (days < 1) return 'less than a day';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
};
