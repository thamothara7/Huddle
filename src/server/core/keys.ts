export const k = {
  item: (itemId: string) => `huddle:items:${itemId}`,
  open: (subId: string) => `huddle:open:${subId}`,
  groupTarget: (subId: string, authorKey: string) =>
    `huddle:groups:${subId}:target:${authorKey}`,
  itemGroups: (itemId: string) => `huddle:item-groups:${itemId}`,
};

export const targetGroupKey = (authorKey: string) =>
  `target:${authorKey}` as const;

export const parseTargetGroupKey = (gk: string): string | null =>
  gk.startsWith('target:') ? gk.slice('target:'.length) : null;
