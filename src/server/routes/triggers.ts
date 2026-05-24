import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnCommentReportRequest,
  OnCommentSubmitRequest,
  OnModActionRequest,
  OnPostReportRequest,
  OnPostSubmitRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createPost();
    const input = await c.req.json<OnAppInstallRequest>();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Huddle installed in r/${context.subredditName} (post ${post.id}, trigger ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`on-app-install error: ${error}`);
    return c.json<TriggerResponse>(
      { status: 'error', message: 'Failed to create Huddle post' },
      400
    );
  }
});

triggers.post('/on-post-report', async (c) => {
  const input = await c.req.json<OnPostReportRequest>();
  console.log(`[huddle] PostReport on ${input.post?.id} reason=${input.reason ?? '(none)'}`);
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-comment-report', async (c) => {
  const input = await c.req.json<OnCommentReportRequest>();
  console.log(`[huddle] CommentReport on ${input.comment?.id} reason=${input.reason ?? '(none)'}`);
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-mod-action', async (c) => {
  const input = await c.req.json<OnModActionRequest>();
  console.log(
    `[huddle] ModAction ${input.action} on ${input.targetPost?.id ?? input.targetComment?.id ?? '?'}`
  );
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-post-submit', async (c) => {
  const input = await c.req.json<OnPostSubmitRequest>();
  console.log(`[huddle] PostSubmit ${input.post?.id} by ${input.author?.name}`);
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-comment-submit', async (c) => {
  const input = await c.req.json<OnCommentSubmitRequest>();
  console.log(`[huddle] CommentSubmit ${input.comment?.id} by ${input.author?.name}`);
  return c.json<TriggerResponse>({}, 200);
});
