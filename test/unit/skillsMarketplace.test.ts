import { describe, it, expect } from 'vitest';
import { MarketplaceClient } from '../../src/skills/Marketplace';
import { HttpRequest, HttpResponse, HttpTransport, TransportError } from '../../src/providers/http';
import { ConclaveError } from '../../src/errors/ErrorReport';

function jsonResponse(status: number, body: unknown): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    header: () => undefined,
    text: async () => JSON.stringify(body),
    json: async () => body,
    // eslint-disable-next-line require-yield
    async *lines() {
      return;
    },
  };
}

class FakeTransport implements HttpTransport {
  lastUrl = '';
  constructor(private readonly responder: (req: HttpRequest) => Promise<HttpResponse>) {}
  send(req: HttpRequest): Promise<HttpResponse> {
    this.lastUrl = req.url;
    return this.responder(req);
  }
}

describe('MarketplaceClient', () => {
  it('parses a {skills:[...]} search response into entries', async () => {
    const t = new FakeTransport(async () =>
      jsonResponse(200, {
        skills: [
          { name: 'pdf-tools', description: 'PDFs', repo: 'owner/pdf-tools', license: 'MIT', installs: 1200, stars: 80 },
          { slug: 'sql-helper', description: 'SQL', url: 'https://x/sql', stars: 5 },
          { description: 'no name or source — dropped' },
        ],
      }),
    );
    const entries = await new MarketplaceClient(t).search('pdf');
    expect(entries.map((e) => e.name)).toEqual(['pdf-tools', 'sql-helper']);
    expect(entries[0].sourceType).toBe('marketplace');
    expect(entries[0].stats).toEqual({ installs: 1200, stars: 80 });
    expect(t.lastUrl).toContain('q=pdf');
  });

  it('accepts a bare array body', async () => {
    const t = new FakeTransport(async () => jsonResponse(200, [{ name: 'x', source: 'owner/x' }]));
    const entries = await new MarketplaceClient(t).search('x');
    expect(entries).toHaveLength(1);
  });

  it('sends category + sortBy + Bearer key', async () => {
    const t = new FakeTransport(async () => jsonResponse(200, { skills: [] }));
    await new MarketplaceClient(t, 'secret-key').search('q', { category: 'data', sortBy: 'popularity' });
    expect(t.lastUrl).toContain('category=data');
    expect(t.lastUrl).toContain('sortBy=popularity');
  });

  it('SKILL-6: a non-OK status throws a typed error', async () => {
    const t = new FakeTransport(async () => jsonResponse(503, {}));
    await expect(new MarketplaceClient(t).search('q')).rejects.toMatchObject({ code: 'SKILL-6' });
  });

  it('SKILL-6: a transport failure throws a typed, retryable error', async () => {
    const t = new FakeTransport(async () => {
      throw new TransportError('offline', 'network');
    });
    try {
      await new MarketplaceClient(t).search('q');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConclaveError);
      expect((err as ConclaveError).code).toBe('SKILL-6');
      expect((err as ConclaveError).canRetry).toBe(true);
    }
  });

  it('SKILL-6: malformed JSON throws a typed error', async () => {
    const t = new FakeTransport(async () => ({
      status: 200,
      ok: true,
      header: () => undefined,
      text: async () => 'not json',
      json: async () => {
        throw new Error('bad json');
      },
      async *lines() {
        return;
      },
    }));
    await expect(new MarketplaceClient(t).search('q')).rejects.toMatchObject({ code: 'SKILL-6' });
  });
});
