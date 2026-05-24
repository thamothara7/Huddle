import { reddit } from '@devvit/web/server';
import { isCommentId, isPostId } from './ids';

export type ReportsSnapshot = {
  userReports: string[];
  modReports: string[];
};

export const fetchReportsSnapshot = async (
  itemId: string
): Promise<ReportsSnapshot | null> => {
  try {
    if (isPostId(itemId)) {
      const post = await reddit.getPostById(itemId);
      return {
        userReports: post.userReportReasons ?? [],
        modReports: post.modReportReasons ?? [],
      };
    }
    if (isCommentId(itemId)) {
      const comment = await reddit.getCommentById(itemId);
      return {
        userReports: comment.userReportReasons ?? [],
        modReports: comment.modReportReasons ?? [],
      };
    }
  } catch (err) {
    console.error(`[huddle] fetchReportsSnapshot failed for ${itemId}:`, err);
  }
  return null;
};
