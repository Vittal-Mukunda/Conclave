// Minimal dense linear algebra for the LinUCB bandit (Phase 12). The context
// dimension is small (~11) so a hand-rolled Gaussian solve is plenty and keeps
// conclave dependency-free — the same pure-TS deviation taken for embeddings
// (ml-matrix would be the heavy alternative; swap it behind these helpers later).
//
// Matrices are row-major number[][]; vectors are number[]. A is always symmetric
// positive-definite (lambda*I + sum x xᵀ, lambda>0), so an unpivoted/partially
// pivoted solve is numerically safe.

export type Vec = number[];
export type Mat = number[][];

/** n×n identity scaled by `scale` (the ridge prior lambda·I). */
export function identity(n: number, scale = 1): Mat {
  const A: Mat = [];
  for (let i = 0; i < n; i++) {
    A.push(new Array(n).fill(0));
    A[i][i] = scale;
  }
  return A;
}

export function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}

/** A += c · (x xᵀ), in place. The LinUCB rank-1 update. */
export function addOuter(A: Mat, x: Vec, c = 1): void {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const xi = x[i] * c;
    const row = A[i];
    for (let j = 0; j < n; j++) {
      row[j] += xi * x[j];
    }
  }
}

/** Solve A·y = b for y via Gaussian elimination with partial pivoting. */
export function solve(A: Mat, b: Vec): Vec {
  const n = b.length;
  // Augmented copy so the inputs are not mutated.
  const M: Mat = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot: largest magnitude in this column at/under the diagonal.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) {
        pivot = r;
      }
    }
    if (pivot !== col) {
      const tmp = M[pivot];
      M[pivot] = M[col];
      M[col] = tmp;
    }
    const diag = M[col][col] || 1e-12; // guarded; A is PD so this is defensive
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / diag;
      if (factor === 0) {
        continue;
      }
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  // Back-substitution.
  const y = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) {
      s -= M[i][j] * y[j];
    }
    y[i] = s / (M[i][i] || 1e-12);
  }
  return y;
}

/** xᵀ A⁻¹ x — the LinUCB confidence-width quadratic form. */
export function quadFormInv(A: Mat, x: Vec): number {
  const y = solve(A, x);
  return Math.max(0, dot(x, y));
}

/** A·x. */
export function matVec(A: Mat, x: Vec): Vec {
  return A.map((row) => dot(row, x));
}
