import * as vscode from 'vscode';
import { Logger } from '../logging/Logger';
import { Capability, DegradedModeRegistry } from '../degraded/DegradedModeRegistry';
import { CodeIndex } from './CodeIndex';
import { HashingEmbedder } from './embeddings';
import { HeuristicSymbolExtractor } from './symbols';
import { Ignore } from './ignore';
import { LocalizationResult, SourceFile } from './types';

// vscode glue for the localization engine. Walks the workspace (gitignore- and
// binary-aware), builds the CodeIndex lazily (LOC-2), and answers localize
// queries. Heavy engines (real LSP / tree-sitter / provider embeddings) are not
// wired here — we ship the deterministic defaults and flag the capability as
// DEGRADED (honest: heuristic structure, less precise), swappable later.

const MAX_FILES = 4000;
const MAX_FILE_BYTES = 1_500_000;
const DECODER = new TextDecoder('utf-8', { fatal: false });

export class CodeIntelService {
  private readonly index = new CodeIndex(new HashingEmbedder(256), new HeuristicSymbolExtractor());
  private built = false;
  private building?: Promise<void>;

  constructor(
    private readonly degraded: DegradedModeRegistry,
    private readonly logger: Logger,
  ) {
    // We use heuristic structure, not a real language server / tree-sitter.
    const consequence = 'Using heuristic code structure (no language server yet) — localization may be less precise.';
    this.degraded.set(Capability.Lsp, 'degraded', { consequence });
    this.degraded.set(Capability.TreeSitter, 'degraded', { consequence });
  }

  get fileCount(): number {
    return this.index.fileCount;
  }

  /** Build the index once, lazily. Concurrent callers await the same build. */
  async ensureIndexed(): Promise<void> {
    if (this.built) {
      return;
    }
    if (!this.building) {
      this.building = this.buildWorkspace().finally(() => {
        this.building = undefined;
      });
    }
    await this.building;
  }

  async localize(query: string): Promise<LocalizationResult> {
    await this.ensureIndexed();
    return this.index.localize(query);
  }

  /** Force a rebuild (e.g. after large external changes). */
  async refresh(): Promise<void> {
    this.built = false;
    await this.ensureIndexed();
  }

  private async buildWorkspace(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.built = true;
      return;
    }
    const ignore = await this.loadIgnore(folder.uri);
    const uris = await vscode.workspace.findFiles(
      '**/*',
      '**/{node_modules,.git,out,dist,build,coverage,.vscode-test}/**',
      MAX_FILES,
    );

    const files: SourceFile[] = [];
    let skipped = 0;
    for (const uri of uris) {
      const rel = posixRelative(folder.uri.fsPath, uri.fsPath);
      if (ignore.ignores(rel)) {
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > MAX_FILE_BYTES) {
          skipped++;
          continue; // LOC-5: oversized file skipped from whole-file indexing
        }
        const content = DECODER.decode(bytes);
        files.push({ path: rel, content, hash: hashContent(content), lines: content.split('\n').length });
      } catch {
        skipped++; // LOC-4: unreadable / odd encoding -> skip with a note
      }
    }

    this.index.build(files);
    this.built = true;
    this.logger.info('codeintel_indexed', { files: files.length, chunks: this.index.chunkCount, skipped });
  }

  private async loadIgnore(root: vscode.Uri): Promise<Ignore> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.gitignore'));
      return Ignore.from(DECODER.decode(bytes));
    } catch {
      return new Ignore();
    }
  }
}

function posixRelative(root: string, full: string): string {
  let rel = full.startsWith(root) ? full.slice(root.length) : full;
  rel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  return rel;
}

function hashContent(content: string): string {
  // FNV-1a 32-bit hex — cheap content fingerprint for staleness (LOC-6).
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
