// Gitignore-aware exclusion plus binary/generated/vendored filtering (LOC-3).
// A small pure matcher — no `ignore` dependency. Supports the common .gitignore
// forms: comments (#), blanks, trailing-slash dir patterns, leading-slash
// anchoring, `*` globs, and negation (!). Good enough for indexing; not a full
// git spec implementation.

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'out',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.vscode-test',
  'vendor',
  'target',
  'bin',
  'obj',
  '__pycache__',
  '.venv',
  'venv',
]);

const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg', 'pdf', 'zip', 'gz',
  'tar', 'rar', '7z', 'exe', 'dll', 'so', 'dylib', 'class', 'jar', 'wasm', 'bin',
  'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp3', 'mp4', 'mov', 'avi', 'wav', 'ogg',
  'pyc', 'pyo', 'o', 'a', 'lib', 'node', 'map',
]);

// Generated / lock files we never want to localize into.
const GENERATED_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'cargo.lock',
  'composer.lock',
  'go.sum',
]);

function ext(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isProbablyBinary(path: string): boolean {
  return BINARY_EXTS.has(ext(path));
}

export function isGenerated(path: string): boolean {
  return GENERATED_NAMES.has(baseName(path).toLowerCase());
}

export function inIgnoredDir(path: string): boolean {
  return path.split('/').some((seg) => DEFAULT_IGNORED_DIRS.has(seg));
}

interface Rule {
  negated: boolean;
  test: (path: string) => boolean;
}

function compile(pattern: string): Rule | undefined {
  let pat = pattern.trim();
  if (pat === '' || pat.startsWith('#')) {
    return undefined;
  }
  const negated = pat.startsWith('!');
  if (negated) {
    pat = pat.slice(1);
  }
  const dirOnly = pat.endsWith('/');
  if (dirOnly) {
    pat = pat.slice(0, -1);
  }
  const anchored = pat.startsWith('/');
  if (anchored) {
    pat = pat.slice(1);
  }

  // Translate the glob into a RegExp. `*` matches within a path segment.
  const body = pat
    .split('/')
    .map((seg) =>
      seg
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]'),
    )
    .join('/');

  const prefix = anchored ? '^' : '(^|.*/)';
  // dirOnly matches the dir and everything under it; otherwise match the path or any descendant.
  const suffix = dirOnly ? '(/.*)?$' : '(/.*)?$';
  const re = new RegExp(`${prefix}${body}${suffix}`);
  return { negated, test: (p: string) => re.test(p) };
}

/** Compiled exclusion set: built-in dirs/binaries/generated + .gitignore rules. */
export class Ignore {
  private readonly rules: Rule[];

  constructor(patterns: string[] = []) {
    this.rules = patterns.map(compile).filter((r): r is Rule => r !== undefined);
  }

  static from(gitignore: string): Ignore {
    return new Ignore(gitignore.split(/\r?\n/));
  }

  /** Should this workspace-relative path be excluded from indexing? */
  ignores(path: string): boolean {
    if (inIgnoredDir(path) || isProbablyBinary(path) || isGenerated(path)) {
      return true;
    }
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.test(path)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}
