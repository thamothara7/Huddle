import { reddit } from '@devvit/web/server';
import { isCommentId, isPostId } from './ids';
import type { ModReportEntry } from '../../shared/api';

export type ReportsSnapshot = {
  userReports: string[];
  modReports: ModReportEntry[];
};

// Reddit's raw mod_reports format is `[[reason, mod_username], ...]`, but the
// Devvit TypeScript surface declares it `string[]`. In practice we may receive
// any of: plain reason strings, `"reason,mod"` joined strings, `[reason, mod]`
// tuples, or `{reason, mod_username}`-shaped objects. Normalize defensively so
// the UI always gets a structured entry and never loses the mod attribution.
const normalizeModReport = (raw: unknown): ModReportEntry => {
  if (typeof raw === 'string') {
    return { reason: raw };
  }
  if (Array.isArray(raw) && raw.length >= 1) {
    const reason =
      typeof raw[0] === 'string' ? raw[0] : String(raw[0] ?? 'mod report');
    const modName =
      raw.length >= 2 && typeof raw[1] === 'string' && raw[1].length > 0
        ? raw[1]
        : undefined;
    return modName ? { reason, modName } : { reason };
  }
  if (raw !== null && typeof raw === 'object') {
    const obj = raw as {
      reason?: unknown;
      mod_username?: unknown;
      modName?: unknown;
      mod?: unknown;
    };
    const reason =
      typeof obj.reason === 'string' && obj.reason.length > 0
        ? obj.reason
        : 'mod report';
    const modCandidate =
      obj.mod_username ?? obj.modName ?? obj.mod ?? undefined;
    const modName =
      typeof modCandidate === 'string' && modCandidate.length > 0
        ? modCandidate
        : undefined;
    return modName ? { reason, modName } : { reason };
  }
  return { reason: String(raw ?? 'mod report') };
};

const normalizeUserReport = (raw: unknown): string => {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return String(raw ?? '');
};

export const fetchReportsSnapshot = async (
  itemId: string
): Promise<ReportsSnapshot | null> => {
  try {
    if (isPostId(itemId)) {
      const post = await reddit.getPostById(itemId);
      return {
        userReports: (post.userReportReasons ?? []).map(normalizeUserReport),
        modReports: (post.modReportReasons ?? []).map(normalizeModReport),
      };
    }
    if (isCommentId(itemId)) {
      const comment = await reddit.getCommentById(itemId);
      return {
        userReports: (comment.userReportReasons ?? []).map(normalizeUserReport),
        modReports: (comment.modReportReasons ?? []).map(normalizeModReport),
      };
    }
  } catch (err) {
    console.error(`[huddle] fetchReportsSnapshot failed for ${itemId}:`, err);
  }
  return null;
};
