export interface User {
  id: number;
  username: string;
  name: string;
  role: 'CENTRE' | 'DISTRICT_OFFICER' | 'QUALITY' | 'STATE';
  districtId: number | null;
  centreId: number | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: { errors?: { row?: number; column?: string; field?: string; message: string }[] },
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'certiflow.token';

export const session = {
  get token() {
    return sessionStorage.getItem(TOKEN_KEY);
  },
  set(token: string | null) {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  },
};

/** fetch wrapper: adds the token, parses JSON, turns error responses into ApiError. */
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (session.token) headers.set('Authorization', `Bearer ${session.token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body.message ?? response.statusText, body);
  return body as T;
}

export const post = <T = any>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data instanceof FormData ? data : JSON.stringify(data ?? {}) });

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  DISTRICT_REVIEW: 'District review',
  QUALITY_REVIEW: 'Quality review',
  STATE_REVIEW: 'State review',
  SENT_BACK: 'Sent back',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
};

export const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : '—');
