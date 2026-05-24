export type QueueItem = {
  itemId: string;
  type: 'post' | 'comment';
  subId: string;
  authorId: string;
  authorName: string;
  parentPostId?: string;
  title?: string;
  reportReasons: string[];
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
