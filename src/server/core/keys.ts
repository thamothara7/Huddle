export const k = {
  item: (itemId: string) => `huddle:items:${itemId}`,
  open: (subId: string) => `huddle:open:${subId}`,
  groupTarget: (subId: string, authorKey: string) =>
    `huddle:groups:${subId}:target:${authorKey}`,
  itemGroups: (itemId: string) => `huddle:item-groups:${itemId}`,
  userStats: (username: string) => `huddle:user:${username}:stats`,
  userRecent: (username: string, subId: string) =>
    `huddle:user:${username}:recent:${subId}`,
  userActions: (username: string, subId: string) =>
    `huddle:user:${username}:actions:${subId}`,
  userSnoovatar: (username: string) => `huddle:user:${username}:snoovatar`,
  summary: (itemId: string) => `huddle:summary:${itemId}`,
  suggestion: (itemId: string) => `huddle:suggestion:${itemId}`,
  geminiBlockedUntil: () => `huddle:gemini:blocked-until`,
};

export const USER_STATS_TTL_SECONDS = 24 * 60 * 60;
export const USER_SNOOVATAR_TTL_SECONDS = 24 * 60 * 60;
export const USER_RECENT_CAP = 20;

export const targetGroupKey = (authorKey: string) =>
  `target:${authorKey}` as const;

export const parseTargetGroupKey = (gk: string): string | null =>
  gk.startsWith('target:') ? gk.slice('target:'.length) : null;
