import { Chunk, SourceFile } from './types';

// Split a file into overlapping line-range chunks (LOC-5). Large files cannot be
// embedded or ranked as one unit, and a precise localization wants line ranges
// anyway. Overlap avoids cutting a relevant region exactly at a boundary.

export interface ChunkOptions {
  maxLines?: number;
  overlap?: number;
}

export function chunkFile(file: SourceFile, opts: ChunkOptions = {}): Chunk[] {
  const maxLines = Math.max(1, opts.maxLines ?? 120);
  const overlap = Math.max(0, Math.min(opts.overlap ?? 20, maxLines - 1));
  const lines = file.content.split('\n');
  const total = lines.length;

  if (total <= maxLines) {
    return [{ file: file.path, startLine: 1, endLine: total, text: file.content }];
  }

  const chunks: Chunk[] = [];
  const step = maxLines - overlap;
  for (let start = 0; start < total; start += step) {
    const end = Math.min(start + maxLines, total);
    chunks.push({
      file: file.path,
      startLine: start + 1,
      endLine: end,
      text: lines.slice(start, end).join('\n'),
    });
    if (end >= total) {
      break;
    }
  }
  return chunks;
}
