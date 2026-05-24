import { getItems } from './items';
import { listOpenItemIds } from './groups';
import type { QueueGroup, QueueItem } from '../../shared/api';

export const fetchGroupedQueue = async (subId: string): Promise<QueueGroup[]> => {
  const ids = await listOpenItemIds(subId);
  if (ids.length === 0) return [];
  const items = await getItems(ids);
  const live = items.filter((x) => x.status === 'open');
  const map = new Map<string, QueueGroup>();
  for (const item of live) {
    const key = `target:${item.authorId}`;
    const existing = map.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      map.set(key, {
        groupKey: key,
        authorId: item.authorId,
        authorName: item.authorName,
        items: [item],
      });
    }
  }
  for (const g of map.values()) {
    g.items.sort((a: QueueItem, b: QueueItem) => b.createdAt - a.createdAt);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.items.length - a.items.length
  );
};
