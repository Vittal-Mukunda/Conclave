import { HttpTransport } from '../providers/http';
import { ConclaveError } from '../errors/ErrorReport';
import { MarketplaceEntry, SkillStats } from './types';

// Skill discovery via the SkillsMP REST API (docs/skills-spec.md INGEST). These
// surfaces are RANKING PRIORS ONLY — not trust, not format. A listing is just a
// pointer; the skill must still be downloaded, SCANNED (scan.ts), and trust-
// evaluated (trust.ts) before anything runs. Built on the injected HttpTransport
// so it is testable without network and reuses the provider timeout/abort path.
//
// The actual folder DOWNLOAD + content-addressed install is the deferred heavy
// piece (git/tarball fetch); search + the ingest/scan/trust pipeline it feeds
// are complete, mirroring the codegen/container deviations elsewhere.

const SKILLSMP_SEARCH = 'https://skillsmp.com/api/v1/skills/search';

interface RawEntry {
  name?: string;
  slug?: string;
  description?: string;
  repo?: string;
  source?: string;
  url?: string;
  license?: string;
  installs?: number;
  stars?: number;
}

function toEntry(raw: RawEntry): MarketplaceEntry | undefined {
  const name = raw.name ?? raw.slug;
  const source = raw.source ?? raw.repo ?? raw.url;
  if (!name || !source) {
    return undefined;
  }
  const stats: SkillStats = {};
  if (typeof raw.installs === 'number') stats.installs = raw.installs;
  if (typeof raw.stars === 'number') stats.stars = raw.stars;
  return {
    name,
    description: raw.description ?? '',
    source,
    sourceType: 'marketplace',
    license: raw.license,
    stats: Object.keys(stats).length ? stats : undefined,
  };
}

export interface MarketplaceSearchOptions {
  category?: string;
  sortBy?: 'relevance' | 'popularity' | 'recent';
}

export class MarketplaceClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly apiKey?: string,
    private readonly baseUrl = SKILLSMP_SEARCH,
  ) {}

  /** Search the marketplace. Throws a typed SKILL-6 error if unreachable. */
  async search(query: string, opts: MarketplaceSearchOptions = {}): Promise<MarketplaceEntry[]> {
    const params = new URLSearchParams({ q: query });
    if (opts.category) params.set('category', opts.category);
    if (opts.sortBy) params.set('sortBy', opts.sortBy);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    let res;
    try {
      res = await this.transport.send(
        { url: `${this.baseUrl}?${params.toString()}`, method: 'GET', headers },
        { timeoutMs: 15_000 },
      );
    } catch (err) {
      throw new ConclaveError({
        category: 'skill',
        code: 'SKILL-6',
        title: 'Skill marketplace unreachable',
        detail: 'Could not reach the skill marketplace search API.',
        cause: err,
        canRetry: true,
        fallbackApplied: 'Local skills only.',
        recoveryActions: [{ label: 'Retry', kind: 'retry', command: 'conclave.searchSkills' }],
      });
    }

    if (!res.ok) {
      throw new ConclaveError({
        category: 'skill',
        code: 'SKILL-6',
        title: 'Skill marketplace error',
        detail: `Marketplace search returned HTTP ${res.status}.`,
        canRetry: true,
        recoveryActions: [{ label: 'Retry', kind: 'retry', command: 'conclave.searchSkills' }],
      });
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new ConclaveError({
        category: 'skill',
        code: 'SKILL-6',
        title: 'Skill marketplace returned malformed data',
        detail: 'Could not parse the marketplace search response.',
        cause: err,
        canRetry: true,
        recoveryActions: [{ label: 'Retry', kind: 'retry', command: 'conclave.searchSkills' }],
      });
    }

    const rawList: RawEntry[] = Array.isArray(body)
      ? (body as RawEntry[])
      : Array.isArray((body as { skills?: RawEntry[] })?.skills)
        ? (body as { skills: RawEntry[] }).skills
        : Array.isArray((body as { results?: RawEntry[] })?.results)
          ? (body as { results: RawEntry[] }).results
          : [];

    return rawList.map(toEntry).filter((e): e is MarketplaceEntry => !!e);
  }
}
