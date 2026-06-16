import { SourceFile, SymbolDef, SymbolExtractor, SymbolKind } from './types';

// Heuristic symbol extractor: regex declaration detection + brace/indent range
// finding. Stands in for tree-sitter / LSP (the SymbolExtractor interface lets a
// real parser replace it without touching the localizer). Covers the common
// TS/JS/Python declaration forms with approximate but useful line ranges.

interface Decl {
  name: string;
  kind: SymbolKind;
  /** Whether the body is delimited by braces (vs python indent / single line). */
  braced: boolean;
}

function matchDecl(line: string): Decl | undefined {
  const s = line.trim();

  let m = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(s);
  if (m) {
    return { name: m[1], kind: 'function', braced: true };
  }
  m = /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(s);
  if (m) {
    return { name: m[1], kind: 'class', braced: true };
  }
  m = /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/.exec(s);
  if (m) {
    return { name: m[1], kind: 'interface', braced: true };
  }
  m = /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/.exec(s);
  if (m) {
    return { name: m[1], kind: 'type', braced: false };
  }
  // const/let assigned a function or arrow.
  m = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/.exec(s);
  if (m) {
    return { name: m[1], kind: 'const', braced: /\{?\s*$/.test(s) && /\{\s*$/.test(s) };
  }
  // Python def / class.
  m = /^(?:async\s+)?def\s+([A-Za-z_$][\w$]*)/.exec(s);
  if (m) {
    return { name: m[1], kind: 'function', braced: false };
  }
  m = /^class\s+([A-Za-z_$][\w$]*)\s*[:(]/.exec(s);
  if (m) {
    return { name: m[1], kind: 'class', braced: false };
  }
  return undefined;
}

function bracedEnd(lines: string[], start: number): number {
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++;
        seen = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    if (seen && depth <= 0) {
      return i + 1; // 1-based
    }
    if (i - start > 2000) {
      break;
    }
  }
  return start + 1;
}

function indentOf(line: string): number {
  const m = /^(\s*)/.exec(line);
  return m ? m[1].length : 0;
}

function indentEnd(lines: string[], start: number): number {
  const base = indentOf(lines[start]);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      continue;
    }
    if (indentOf(lines[i]) <= base) {
      return i; // previous line (1-based = i) is the last in-block line
    }
  }
  return lines.length;
}

export class HeuristicSymbolExtractor implements SymbolExtractor {
  extract(file: SourceFile): SymbolDef[] {
    const lines = file.content.split('\n');
    const out: SymbolDef[] = [];
    for (let i = 0; i < lines.length; i++) {
      const decl = matchDecl(lines[i]);
      if (!decl) {
        continue;
      }
      let endLine: number;
      if (decl.kind === 'type') {
        endLine = i + 1;
      } else if (decl.braced || /\{\s*$/.test(lines[i]) || lines[i].includes('{')) {
        endLine = bracedEnd(lines, i);
      } else {
        // python-style or single-line.
        endLine = /:\s*$/.test(lines[i]) ? indentEnd(lines, i) : i + 1;
      }
      out.push({
        file: file.path,
        name: decl.name,
        kind: decl.kind,
        startLine: i + 1,
        endLine: Math.max(endLine, i + 1),
      });
    }
    return out;
  }
}
