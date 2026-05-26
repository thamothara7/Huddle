import { context, reddit, redis } from '@devvit/web/server';
import { k } from './keys';

const MODERATOR_ACCESS_CACHE_TTL_MS = 60 * 1000;

type ModeratorAccessResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 503; message: string };

export const verifyModeratorAccess =
  async (): Promise<ModeratorAccessResult> => {
    const { subredditId, subredditName, userId } = context;
    if (!subredditId || !subredditName) {
      return { ok: false, status: 400, message: 'missing subreddit context' };
    }
    if (!userId) {
      return { ok: false, status: 401, message: 'moderator sign-in required' };
    }

    const accessKey = k.moderatorAccess(subredditId, userId);
    if ((await redis.get(accessKey)) === '1') {
      return { ok: true };
    }

    try {
      const user = await reddit.getCurrentUser();
      const permissions = user
        ? await user.getModPermissionsForSubreddit(subredditName)
        : [];
      if (permissions.length === 0) {
        return { ok: false, status: 403, message: 'moderator access required' };
      }
      await redis.set(accessKey, '1', {
        expiration: new Date(Date.now() + MODERATOR_ACCESS_CACHE_TTL_MS),
      });
      return { ok: true };
    } catch (error) {
      console.error('[huddle] moderator access check failed:', error);
      return {
        ok: false,
        status: 503,
        message: 'could not verify moderator access',
      };
    }
  };
