/**
 * Simplified UMAP (Uniform Manifold Approximation and Projection) implementation.
 * Pure TypeScript, no external dependencies.
 *
 * Algorithm overview:
 * 1. Compute pairwise cosine distances
 * 2. Find k nearest neighbors for each point
 * 3. Compute fuzzy membership weights (binary search for sigma per point)
 * 4. Build symmetric fuzzy graph
 * 5. Initialize with random positions (seeded PRNG)
 * 6. SGD optimization with attractive + repulsive forces
 * 7. Return normalized coordinates
 */

// --- Public types ---

export interface UMAPOptions {
  nComponents: 2 | 3;
  nNeighbors?: number;
  minDist?: number;
  nEpochs?: number;
  onProgress?: (fraction: number) => void;
}

export interface UMAPResult {
  coordinates: number[][];
}

// --- Seeded PRNG (xorshift32) ---

function createRng(seed: number): () => number {
  let state = seed | 0 || 1;
  return (): number => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

// --- Distance and neighbor functions ---

/**
 * Compute cosine distance between two vectors.
 * Returns a value in [0, 2], where 0 = identical, 1 = orthogonal, 2 = opposite.
 */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  const similarity = dot / denom;
  // Clamp to handle floating point errors
  return 1 - Math.max(-1, Math.min(1, similarity));
}

/**
 * Find k nearest neighbors for each point using brute force.
 * Returns indices and distances arrays (excluding self).
 */
export function findKNN(
  vectors: number[][],
  k: number,
): { indices: number[][]; distances: number[][] } {
  const n = vectors.length;
  const effectiveK = Math.min(k, n - 1);
  const indices: number[][] = [];
  const distances: number[][] = [];

  for (let i = 0; i < n; i++) {
    const dists: Array<{ idx: number; dist: number }> = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      dists.push({ idx: j, dist: cosineDistance(vectors[i]!, vectors[j]!) });
    }
    dists.sort((a, b) => a.dist - b.dist);
    const topK = dists.slice(0, effectiveK);
    indices.push(topK.map((d) => d.idx));
    distances.push(topK.map((d) => d.dist));
  }

  return { indices, distances };
}

// --- Fuzzy set membership ---

const SMOOTH_K_TOLERANCE = 1e-5;
const N_ITER_BINARY_SEARCH = 64;
const TARGET_LOG2 = Math.log(2);

/**
 * For a single point, binary-search for sigma such that
 * sum(exp(-d/sigma)) ~ log2(k).
 */
function computeSigma(
  distances: number[],
  targetEntropy: number,
): number {
  let lo = 1e-10;
  let hi = 1000;
  let mid = 1;

  for (let iter = 0; iter < N_ITER_BINARY_SEARCH; iter++) {
    mid = (lo + hi) / 2;
    let sum = 0;
    for (const d of distances) {
      sum += Math.exp(-d / mid);
    }
    const entropy = Math.log(sum + 1e-10);
    if (Math.abs(entropy - targetEntropy) < SMOOTH_K_TOLERANCE) {
      break;
    }
    if (entropy > targetEntropy) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return mid;
}

/**
 * Compute fuzzy membership weights and build symmetric graph.
 * Returns an edge list with weights.
 */
function buildFuzzyGraph(
  knnIndices: number[][],
  knnDistances: number[][],
  nNeighbors: number,
): Array<{ i: number; j: number; weight: number }> {
  const n = knnIndices.length;
  const targetEntropy = Math.log(nNeighbors) + TARGET_LOG2;

  // Compute conditional probabilities p(j|i)
  const condProbs = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const dists = knnDistances[i]!;
    const idxs = knnIndices[i]!;
    const sigma = computeSigma(dists, targetEntropy);

    for (let k = 0; k < idxs.length; k++) {
      const j = idxs[k]!;
      const d = dists[k]!;
      const p = Math.exp(-d / sigma);
      condProbs.set(`${i},${j}`, p);
    }
  }

  // Symmetrize: w_sym = p(j|i) + p(i|j) - p(j|i)*p(i|j)
  const edgeMap = new Map<string, { i: number; j: number; weight: number }>();

  for (const [key, pij] of condProbs) {
    const parts = key.split(',');
    const i = parseInt(parts[0]!, 10);
    const j = parseInt(parts[1]!, 10);
    const pji = condProbs.get(`${j},${i}`) ?? 0;

    const symWeight = pij + pji - pij * pji;

    // Use canonical key (smaller index first)
    const canonKey = i < j ? `${i},${j}` : `${j},${i}`;
    if (!edgeMap.has(canonKey)) {
      edgeMap.set(canonKey, {
        i: Math.min(i, j),
        j: Math.max(i, j),
        weight: symWeight,
      });
    }
  }

  return [...edgeMap.values()].filter((e) => e.weight > 0);
}

// --- SGD optimization ---

function optimizeLayout(
  nPoints: number,
  nComponents: number,
  edges: Array<{ i: number; j: number; weight: number }>,
  nEpochs: number,
  minDist: number,
  rng: () => number,
  onProgress?: (fraction: number) => void,
): number[][] {
  // Initialize positions randomly
  const coords: number[][] = [];
  for (let i = 0; i < nPoints; i++) {
    const point: number[] = [];
    for (let d = 0; d < nComponents; d++) {
      point.push((rng() - 0.5) * 20);
    }
    coords.push(point);
  }

  if (edges.length === 0 || nPoints <= 1) {
    onProgress?.(1);
    return coords;
  }

  // Precompute a and b parameters for the smooth approximation
  // These control the shape of the curve used for attractive/repulsive forces
  const a = 1.929;
  const b = 0.7915 + 0.3 * minDist;

  const initialAlpha = 1.0;
  const negativeSampleRate = 5;

  // Compute epochs per edge based on weight
  const maxWeight = Math.max(...edges.map((e) => e.weight));
  const epochsPerEdge = edges.map((e) =>
    Math.max(1, Math.round((e.weight / maxWeight) * nEpochs)),
  );

  for (let epoch = 0; epoch < nEpochs; epoch++) {
    const alpha = initialAlpha * (1 - epoch / nEpochs);

    // Process edges
    for (let edgeIdx = 0; edgeIdx < edges.length; edgeIdx++) {
      if (epoch % Math.max(1, Math.floor(nEpochs / epochsPerEdge[edgeIdx]!)) !== 0) {
        continue;
      }

      const edge = edges[edgeIdx]!;
      const pointI = coords[edge.i]!;
      const pointJ = coords[edge.j]!;

      // Compute distance
      let distSq = 0;
      for (let d = 0; d < nComponents; d++) {
        const diff = pointI[d]! - pointJ[d]!;
        distSq += diff * diff;
      }
      distSq = Math.max(distSq, 1e-8);
      const dist = Math.sqrt(distSq);

      // Attractive force
      const gradCoeff = (-2 * a * b * Math.pow(distSq, b - 1)) /
        (1 + a * Math.pow(distSq, b));

      for (let d = 0; d < nComponents; d++) {
        const grad = gradCoeff * (pointI[d]! - pointJ[d]!) / dist;
        const clippedGrad = Math.max(-4, Math.min(4, grad));
        pointI[d]! += clippedGrad * alpha;
        pointJ[d]! -= clippedGrad * alpha;
      }

      // Negative sampling (repulsive forces)
      for (let neg = 0; neg < negativeSampleRate; neg++) {
        const k = Math.floor(rng() * nPoints);
        if (k === edge.i) continue;

        const pointK = coords[k]!;
        let negDistSq = 0;
        for (let d = 0; d < nComponents; d++) {
          const diff = pointI[d]! - pointK[d]!;
          negDistSq += diff * diff;
        }
        negDistSq = Math.max(negDistSq, 1e-8);
        const negDist = Math.sqrt(negDistSq);

        // Repulsive force
        const repGradCoeff = (2 * b) /
          ((0.001 + negDistSq) * (1 + a * Math.pow(negDistSq, b)));

        for (let d = 0; d < nComponents; d++) {
          const grad = repGradCoeff * (pointI[d]! - pointK[d]!) / negDist;
          const clippedGrad = Math.max(-4, Math.min(4, grad));
          pointI[d]! += clippedGrad * alpha;
        }
      }
    }

    if (epoch % 10 === 0 || epoch === nEpochs - 1) {
      onProgress?.((epoch + 1) / nEpochs);
    }
  }

  return coords;
}

// --- Normalization ---

function normalizeCoordinates(coords: number[][]): number[][] {
  if (coords.length === 0) return coords;

  const nComponents = coords[0]!.length;

  // Find min/max per dimension
  const mins = new Array<number>(nComponents).fill(Infinity);
  const maxs = new Array<number>(nComponents).fill(-Infinity);

  for (const point of coords) {
    for (let d = 0; d < nComponents; d++) {
      const val = point[d]!;
      if (val < mins[d]!) mins[d] = val;
      if (val > maxs[d]!) maxs[d] = val;
    }
  }

  // Normalize to [0, 1]
  return coords.map((point) =>
    point.map((val, d) => {
      const range = maxs[d]! - mins[d]!;
      if (range === 0) return 0.5;
      return (val - mins[d]!) / range;
    }),
  );
}

// --- Main UMAP function ---

/**
 * Perform UMAP dimensionality reduction on high-dimensional vectors.
 *
 * @param vectors - Array of vectors (each vector is number[])
 * @param options - UMAP configuration options
 * @returns UMAPResult with coordinates in [0, 1] range
 */
export function umap(vectors: number[][], options: UMAPOptions): UMAPResult {
  const {
    nComponents,
    nNeighbors = 15,
    minDist = 0.1,
    nEpochs = 200,
    onProgress,
  } = options;

  const n = vectors.length;

  // Edge cases
  if (n === 0) {
    onProgress?.(1);
    return { coordinates: [] };
  }

  if (n === 1) {
    onProgress?.(1);
    const point = new Array<number>(nComponents).fill(0.5);
    return { coordinates: [point] };
  }

  // Step 1-2: Find k nearest neighbors
  const effectiveK = Math.min(nNeighbors, n - 1);
  const { indices, distances } = findKNN(vectors, effectiveK);

  // Step 3-4: Build fuzzy membership graph
  const edges = buildFuzzyGraph(indices, distances, effectiveK);

  // Step 5-6: SGD optimization
  const rng = createRng(42);
  const coords = optimizeLayout(
    n,
    nComponents,
    edges,
    nEpochs,
    minDist,
    rng,
    onProgress,
  );

  // Step 7: Normalize coordinates to [0, 1]
  const normalized = normalizeCoordinates(coords);

  return { coordinates: normalized };
}
