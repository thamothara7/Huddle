export type ModReportEntry = {
  reason: string;
  modName?: string;
};

export type QueueItem = {
  itemId: string;
  type: 'post' | 'comment';
  subId: string;
  authorId: string;
  authorName: string;
  parentPostId?: string;
  title?: string;
  permalink?: string;
  reportReasons: string[];
  modReports?: ModReportEntry[];
  reportCount: number;
  createdAt: number;
  status: 'open' | 'actioned';
  actionedBy?: string;
  actionTaken?: 'approve' | 'remove' | 'spam';
};

export type QueueGroup = {
  groupKey: string;
  authorId: string;
  authorName: string;
  items: QueueItem[];
};

export type InitResponse = {
  type: 'init';
  postId: string;
  subredditName: string;
  username: string;
  groups: QueueGroup[];
};

export type ActionRequest = {
  itemId: string;
  action: 'approve' | 'remove';
};

export type ActionResponse = {
  type: 'action';
  itemId: string;
  action: 'approve' | 'remove';
  ok: boolean;
};

export type BulkActionRequest = {
  itemIds: string[];
  action: 'approve' | 'remove';
};

export type BulkActionResult = {
  itemId: string;
  ok: boolean;
  error?: string;
};

export type BulkActionResponse = {
  type: 'action-bulk';
  action: 'approve' | 'remove';
  results: BulkActionResult[];
  okCount: number;
  failCount: number;
};

export type UserFacts = {
  accountAgeDays: number;
  postsInSubTotal: number;
  commentsInSubTotal: number;
  inSubLast7d: number;
  removedInSubTotal: number;
};

export type SummarySource = 'cache' | 'llm' | 'fallback';

export type SummaryResponse = {
  type: 'summary';
  itemId: string;
  summary: string;
  source: SummarySource;
};

export type RecentEntry = {
  itemId: string;
  title: string;
  status: 'pending' | 'approved' | 'removed' | 'spam';
  createdAt: number;
};

export type ActionEntry = {
  action: 'approve' | 'remove' | 'spam' | 'ban' | 'mute';
  modId: string;
  itemId: string;
  timestamp: number;
};

export type ContextPeekResponse = {
  type: 'context-peek';
  itemId: string;
  authorName: string;
  facts: UserFacts;
  recent: RecentEntry[];
  actions: ActionEntry[];
};
