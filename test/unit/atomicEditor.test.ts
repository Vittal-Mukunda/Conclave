import { describe, it, expect } from 'vitest';
import { AtomicEditor } from '../../src/editing/AtomicEditor';
import { hashContent } from '../../src/editing/hash';
import { EditPlan, FileState } from '../../src/editing/types';

function states(...s: FileState[]): Map<string, FileState> {
  return new Map(s.map((x) => [x.path, x]));
}

describe('AtomicEditor', () => {
  it('writes whole-content edits', () => {
    const e = new AtomicEditor();
    const plan: EditPlan = { edits: [{ path: '/w/a.ts', newContent: 'new' }] };
    const r = e.plan(plan, states({ path: '/w/a.ts', content: 'old' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.writes).toEqual([{ path: '/w/a.ts', content: 'new' }]);
  });

  it('applies hunk edits against current content', () => {
    const e = new AtomicEditor();
    const plan: EditPlan = {
      edits: [{ path: '/w/a.ts', hunks: [{ startLine: 1, oldLines: ['a'], newLines: ['A'] }] }],
    };
    const r = e.plan(plan, states({ path: '/w/a.ts', content: 'a\nb' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.writes[0].content).toBe('A\nb');
  });

  it('EDIT-1: fails on base-hash drift, never forcing', () => {
    const e = new AtomicEditor();
    const plan: EditPlan = { edits: [{ path: '/w/a.ts', baseHash: hashContent('old'), newContent: 'x' }] };
    const r = e.plan(plan, states({ path: '/w/a.ts', content: 'CHANGED' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0].code).toBe('EDIT-1');
  });

  it('passes when base hash matches', () => {
    const e = new AtomicEditor();
    const plan: EditPlan = { edits: [{ path: '/w/a.ts', baseHash: hashContent('old'), newContent: 'x' }] };
    const r = e.plan(plan, states({ path: '/w/a.ts', content: 'old' }));
    expect(r.ok).toBe(true);
  });

  it('EDIT-2: blocks edits outside the workspace', () => {
    const e = new AtomicEditor((p) => p.startsWith('/w/'));
    const plan: EditPlan = { edits: [{ path: '/etc/passwd', newContent: 'x' }] };
    const r = e.plan(plan, states({ path: '/etc/passwd', content: 'old' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0].code).toBe('EDIT-2');
  });

  it('EDIT-4: refuses files with conflict markers', () => {
    const e = new AtomicEditor();
    const plan: EditPlan = { edits: [{ path: '/w/a.ts', newContent: 'x' }] };
    const r = e.plan(plan, states({ path: '/w/a.ts', content: '<<<<<<< HEAD\na' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0].code).toBe('EDIT-4');
  });

  it('EDIT-9: missing target file fails', () => {
    const e = new AtomicEditor();
    const plan: EditPlan = { edits: [{ path: '/w/missing.ts', hunks: [{ startLine: 1, oldLines: ['a'], newLines: ['b'] }] }] };
    const r = e.plan(plan, new Map());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0].code).toBe('EDIT-9');
  });

  it('EDIT-7: one failure aborts the whole plan — zero writes', () => {
    const e = new AtomicEditor();
    const plan: EditPlan = {
      edits: [
        { path: '/w/ok.ts', newContent: 'fine' },
        { path: '/w/drift.ts', baseHash: hashContent('orig'), newContent: 'x' },
      ],
    };
    const r = e.plan(
      plan,
      states(
        { path: '/w/ok.ts', content: 'old' },
        { path: '/w/drift.ts', content: 'DRIFTED' },
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.map((f) => f.code)).toEqual(['EDIT-1']);
  });

  it('EDIT-6: flags a dirty buffer as reconciled', () => {
    const e = new AtomicEditor();
    const plan: EditPlan = { edits: [{ path: '/w/a.ts', newContent: 'x' }] };
    const r = e.plan(plan, states({ path: '/w/a.ts', content: 'buf', bufferDirty: true }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reconciled).toEqual(['/w/a.ts']);
  });
});
