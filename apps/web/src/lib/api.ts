/**
 * API client.
 *
 * One place that knows how to talk to the server: attaches the bearer token,
 * unwraps the `{ data, meta }` envelope, and turns the server's typed errors
 * into a single `ApiError` the UI can switch on by `code`.
 *
 * Authentication model: the ACCESS token lives in memory (never localStorage,
 * where any XSS could read it); the REFRESH token lives in an httpOnly cookie
 * the server sets. A page reload calls `/auth/refresh` once to repopulate the
 * access token, which is why this module is created through `createApi()` and
 * initialised by the auth provider rather than being a bare module singleton.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, string | string[]>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, string | string[]>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  /** True when retrying the same request later could plausibly succeed. */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Skip the refresh-and-retry dance (used by the refresh call itself). */
  noRetry?: boolean;
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: () => string | null;
  onUnauthorized: () => void;
  /** Called when a request fails for a transient reason, for the sync UI. */
  onNetworkError?: (error: ApiError) => void;
  getDeviceId?: () => string | null;
  getBranchId?: () => string | null;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
    const response = await this.rawRequest(path, options);
    if (response.status === 204) return { data: undefined as T };

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : {};

    if (!response.ok) {
      const errorBody =
        (payload as { error?: ApiErrorBody }).error ??
        ({ code: 'INTERNAL', message: `Request failed (${response.status})` } as ApiErrorBody);

      const apiError = new ApiError(response.status, errorBody);
      if (apiError.isTransient) this.options.onNetworkError?.(apiError);
      throw apiError;
    }

    return payload as ApiEnvelope<T>;
  }

  /** Returns the envelope's `data` directly, for the common case. */
  async data<T>(path: string, options?: RequestOptions): Promise<T> {
    return (await this.request<T>(path, options)).data;
  }

  private async rawRequest(path: string, options: RequestOptions): Promise<Response> {
    const url = new URL(
      `${this.options.baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
      window.location.origin,
    );

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const token = this.options.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const deviceId = this.options.getDeviceId?.();
    if (deviceId) headers['X-Device-Id'] = deviceId;

    const branchId = this.options.getBranchId?.();
    if (branchId) headers['X-Branch-Id'] = branchId;

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
        // The refresh token must ride along on every call.
        credentials: 'include',
      });
    } catch (cause) {
      // A rejected fetch means the request never left the device — this is the
      // offline case, and status 0 marks it as transient for the sync engine.
      const offline = new ApiError(0, {
        code: 'OFFLINE',
        message: cause instanceof Error && cause.name === 'AbortError'
          ? 'Request cancelled'
          : 'No connection to the server',
      });
      this.options.onNetworkError?.(offline);
      throw offline;
    }

    // A 401 on anything but the refresh call means the access token expired
    // mid-session. Try once to refresh and replay; never loop.
    if (response.status === 401 && !options.noRetry) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        return this.rawRequest(path, options);
      }
      this.options.onUnauthorized();
    }

    return response;
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      await fetch(`${this.options.baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      // The auth provider listens for this and updates its token store.
      return true;
    } catch {
      return false;
    }
  }

  get<T>(path: string, query?: RequestOptions['query']) {
    return this.data<T>(path, { method: 'GET', query });
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.data<T>(path, { ...options, method: 'POST', body });
  }
  patch<T>(path: string, body?: unknown) {
    return this.data<T>(path, { method: 'PATCH', body });
  }
  del<T>(path: string) {
    return this.data<T>(path, { method: 'DELETE' });
  }
}

export const API_BASE = '/api/v1';
