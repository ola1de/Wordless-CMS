export interface ActivityEntry {
  id: number;
  /** 0 = anonymous visitor / system. */
  actorId: number;
  action: string;
  objectType: string | null;
  objectId: string | null;
  details: string | null;
  createdAt: string;
}

export interface LogActivityInput {
  actorId: number;
  action: string;
  objectType?: string;
  objectId?: string | number;
  details?: string;
  ipHash?: string;
}

export interface ListActivityOptions {
  page?: number;
  perPage?: number;
}

export interface ActivityListResult {
  entries: ActivityEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
