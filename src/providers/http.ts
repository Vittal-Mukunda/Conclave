// Transport abstraction. LLMClient depends on HttpTransport, not on fetch
// directly, so unit tests can inject canned responses (including SSE streams)
// without real network IO.

export interface HttpRequest {
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
  /** Decoded text lines (used for Server-Sent-Events streaming). */
  lines(): AsyncIterable<string>;
  /** Response header lookup (case-insensitive), e.g. 'retry-after'. */
  header(name: string): string | undefined;
}

export interface SendOptions {
  stream?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpTransport {
  send(req: HttpRequest, opts?: SendOptions): Promise<HttpResponse>;
}

/** Raised by the transport for network-level failures (DNS, refused, timeout). */
export class TransportError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/** Default transport backed by the global fetch (Node 18+ / undici). */
export class FetchTransport implements HttpTransport {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async send(req: HttpRequest, opts: SendOptions = {}): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 60000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Chain an external signal if provided.
    if (opts.signal) {
      if (opts.signal.aborted) {
        controller.abort();
      } else {
        opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    let res: Response;
    try {
      res = await this.fetchFn(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as { name?: string })?.name === 'AbortError';
      throw new TransportError(
        aborted ? 'Request timed out' : 'Network request failed',
        aborted ? 'timeout' : 'network',
        err,
      );
    }

    return wrapResponse(res, timer);
  }
}

function wrapResponse(res: Response, timer: ReturnType<typeof setTimeout>): HttpResponse {
  let settled = false;
  const done = (): void => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
    }
  };

  return {
    status: res.status,
    ok: res.ok,
    header(name: string) {
      return res.headers.get(name) ?? undefined;
    },
    async text() {
      try {
        return await res.text();
      } finally {
        done();
      }
    },
    async json() {
      try {
        return (await res.json()) as unknown;
      } finally {
        done();
      }
    },
    async *lines() {
      try {
        const body = res.body as AsyncIterable<Uint8Array> | null;
        if (!body) {
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of body) {
          buffer += decoder.decode(chunk, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).replace(/\r$/, '');
            buffer = buffer.slice(nl + 1);
            yield line;
          }
        }
        if (buffer.length > 0) {
          yield buffer;
        }
      } finally {
        done();
      }
    },
  };
}
