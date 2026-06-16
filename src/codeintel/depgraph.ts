import { SourceFile } from './types';

// Lightweight dependency graph from import/require/from edges. Used as a ranking
// signal: code relevant to a task tends to cluster near other relevant code, so
// a candidate file imported-by or importing a strong hit gets a proximity boost.
// Module resolution is best-effort over the known file set (no node_modules).

const IMPORT_RES = [
  /import\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
  /from\s+([A-Za-z0-9_.]+)\s+import/g, // python
];

const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

export class DependencyGraph {
  /** Undirected adjacency for proximity queries. */
  private readonly adj = new Map<string, Set<string>>();

  constructor(files: SourceFile[]) {
    const known = new Set(files.map((f) => f.path));
    for (const f of files) {
      for (const target of this.parseImports(f.content)) {
        const resolved = this.resolve(f.path, target, known);
        if (resolved && resolved !== f.path) {
          this.link(f.path, resolved);
        }
      }
    }
  }

  private parseImports(content: string): string[] {
    const specs: string[] = [];
    for (const re of IMPORT_RES) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        specs.push(m[1]);
      }
    }
    return specs;
  }

  private resolve(from: string, spec: string, known: Set<string>): string | undefined {
    if (!spec.startsWith('.')) {
      return undefined; // external package or bare module
    }
    const base = normalize(`${dirname(from)}/${spec}`);
    for (const ext of EXTS) {
      const cand = base + ext;
      if (known.has(cand)) {
        return cand;
      }
    }
    for (const idx of ['/index.ts', '/index.js', '/index.tsx']) {
      if (known.has(base + idx)) {
        return base + idx;
      }
    }
    return undefined;
  }

  private link(a: string, b: string): void {
    if (!this.adj.has(a)) {
      this.adj.set(a, new Set());
    }
    if (!this.adj.has(b)) {
      this.adj.set(b, new Set());
    }
    this.adj.get(a)!.add(b);
    this.adj.get(b)!.add(a);
  }

  neighbors(file: string): string[] {
    return [...(this.adj.get(file) ?? [])];
  }

  get edgeCount(): number {
    let n = 0;
    for (const s of this.adj.values()) {
      n += s.size;
    }
    return n / 2;
  }

  /** Shortest-path hop count between two files, or Infinity if disconnected. */
  distance(a: string, b: string): number {
    if (a === b) {
      return 0;
    }
    const seen = new Set<string>([a]);
    let frontier = [a];
    let dist = 0;
    while (frontier.length) {
      dist++;
      const next: string[] = [];
      for (const node of frontier) {
        for (const nb of this.adj.get(node) ?? []) {
          if (nb === b) {
            return dist;
          }
          if (!seen.has(nb)) {
            seen.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
      if (dist > 64) {
        break;
      }
    }
    return Infinity;
  }

  /** Proximity boost in (0,1] of a file to a set of seed files (closest wins). */
  proximityBoost(seeds: Iterable<string>, file: string): number {
    let best = 0;
    for (const s of seeds) {
      if (s === file) {
        continue;
      }
      const d = this.distance(s, file);
      if (d !== Infinity) {
        best = Math.max(best, 1 / (1 + d));
      }
    }
    return best;
  }
}
