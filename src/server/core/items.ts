import { redis } from '@devvit/web/server';
import { k } from './keys';
import type { QueueItem } from '../../shared/api';

export const getItem = async (itemId: string): Promise<QueueItem | null> => {
  const raw = await redis.get(k.item(itemId));
  if (!raw) return null;
  return JSON.parse(raw) as QueueItem;
};

export const setItem = async (item: QueueItem): Promise<void> => {
  await redis.set(k.item(item.itemId), JSON.stringify(item));
};

export const getItems = async (itemIds: string[]): Promise<QueueItem[]> => {
  if (itemIds.length === 0) return [];
  const raws = await redis.mGet(itemIds.map(k.item));
  const out: QueueItem[] = [];
  for (const raw of raws) {
    if (raw) out.push(JSON.parse(raw) as QueueItem);
  }
  return out;
};

export const upsertReport = async (
  itemId: string,
  create: () => QueueItem,
  reason: string | undefined
): Promise<QueueItem> => {
  const existing = await getItem(itemId);
  if (existing) {
    existing.reportCount += 1;
    if (reason && !existing.reportReasons.includes(reason)) {
      existing.reportReasons.push(reason);
    }
    await setItem(existing);
    return existing;
  }
  const fresh = create();
  if (reason && !fresh.reportReasons.includes(reason)) {
    fresh.reportReasons.push(reason);
  }
  await setItem(fresh);
  return fresh;
};
