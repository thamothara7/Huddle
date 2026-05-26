import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { verifyModeratorAccess } from '../core/auth';
import { createPost } from '../core/post';

export const menu = new Hono();

menu.use('*', async (c, next) => {
  const access = await verifyModeratorAccess();
  if (!access.ok) {
    return c.json<UiResponse>(
      { showToast: access.message },
      access.status
    );
  }
  await next();
});

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});
