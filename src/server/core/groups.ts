import { redis } from '@devvit/web/server';
import { k, parseTargetGroupKey, targetGroupKey } from './keys';

export const addItemToGroups = async (
  subId: string,
  itemId: string,
  authorKey: string,
  ts: number
): Promise<void> => {
  const gk = targetGroupKey(authorKey);
  await Promise.all([
    redis.zAdd(k.open(subId), { member: itemId, score: ts }),
    redis.zAdd(k.groupTarget(subId, authorKey), { member: itemId, score: ts }),
    redis.zAdd(k.itemGroups(itemId), { member: gk, score: ts }),
  ]);
};

export const removeItemFromAllGroups = async (
  subId: string,
  itemId: string
): Promise<void> => {
  const rows = await redis.zRange(k.itemGroups(itemId), 0, -1, { by: 'rank' });
  const removals: Promise<unknown>[] = [
    redis.zRem(k.open(subId), [itemId]),
    redis.del(k.itemGroups(itemId)),
  ];
  for (const row of rows) {
    const authorKey = parseTargetGroupKey(row.member);
    if (authorKey) {
      removals.push(redis.zRem(k.groupTarget(subId, authorKey), [itemId]));
    }
  }
  await Promise.all(removals);
};

export const listOpenItemIds = async (subId: string): Promise<string[]> => {
  const rows = await redis.zRange(k.open(subId), 0, -1, {
    by: 'rank',
    reverse: true,
  });
  return rows.map((r) => r.member);
};
