export const isPostId = (s: string): s is `t3_${string}` => s.startsWith('t3_');

export const isCommentId = (s: string): s is `t1_${string}` =>
  s.startsWith('t1_');

export const isThingId = (
  s: string
): s is `t3_${string}` | `t1_${string}` => isPostId(s) || isCommentId(s);

export const isUserId = (s: string): s is `t2_${string}` => s.startsWith('t2_');
