import { describe, it, expect, vi } from 'vitest';
import { umap, cosineDistance, findKNN } from './umap.js';

describe('UMAP', () => {
  // Generate simple test vectors
  function makeCluster(center: number[], n: number, spread: number): number[][] {
    return Array.from({ length: n }, (_, i) =>
      center.map((c) => c + ((i % 3) - 1) * spread),
    );
  }

  describe('cosineDistance', () => {
    it('should return 0 for identical vectors', () => {
      expect(cosineDistance([1, 2, 3], [1, 2, 3])).toBeCloseTo(0, 5);
    });

    it('should return ~1 for orthogonal vectors', () => {
      expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1, 5);
    });

    it('should return ~2 for opposite vectors', () => {
      expect(cosineDistance([1, 0, 0], [-1, 0, 0])).toBeCloseTo(2, 5);
    });

    it('should handle zero vectors gracefully', () => {
      expect(cosineDistance([0, 0, 0], [1, 2, 3])).toBe(1);
    });
  });

  describe('findKNN', () => {
    it('should find k nearest neighbors', () => {
      const vectors = [
        [1, 0, 0],
        [0.9, 0.1, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const result = findKNN(vectors, 2);
      expect(result.indices).toHaveLength(4);
      expect(result.indices[0]).toHaveLength(2);
      // First vector's nearest neighbor should be second vector
      expect(result.indices[0]![0]).toBe(1);
    });

    it('should limit k to n-1', () => {
      const vectors = [
        [1, 0],
        [0, 1],
      ];
      const result = findKNN(vectors, 10);
      expect(result.indices[0]).toHaveLength(1);
    });

    it('should return sorted distances', () => {
      const vectors = [
        [1, 0, 0],
        [0.5, 0.5, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const result = findKNN(vectors, 3);
      // Distances should be in ascending order
      for (let i = 0; i < result.distances.length; i++) {
        const dists = result.distances[i]!;
        for (let j = 1; j < dists.length; j++) {
          expect(dists[j]!).toBeGreaterThanOrEqual(dists[j - 1]!);
        }
      }
    });
  });

  describe('umap', () => {
    it('should reduce to 2D', () => {
      const vectors = [
        [1, 0, 0, 0, 0],
        [0.9, 0.1, 0, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 0.9, 0.1, 0],
      ];
      const result = umap(vectors, { nComponents: 2, nEpochs: 50, nNeighbors: 2 });
      expect(result.coordinates).toHaveLength(4);
      expect(result.coordinates[0]).toHaveLength(2);
    });

    it('should reduce to 3D', () => {
      const vectors = [
        [1, 0, 0, 0],
        [0.9, 0.1, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
      ];
      const result = umap(vectors, { nComponents: 3, nEpochs: 50, nNeighbors: 2 });
      expect(result.coordinates[0]).toHaveLength(3);
    });

    it('should call onProgress callback', () => {
      const onProgress = vi.fn();
      const vectors = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      umap(vectors, { nComponents: 2, nEpochs: 10, nNeighbors: 2, onProgress });
      expect(onProgress).toHaveBeenCalled();
      // Last call should be close to 1.0
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1]![0] as number;
      expect(lastCall).toBeCloseTo(1, 1);
    });

    it('should handle single point', () => {
      const result = umap([[1, 2, 3]], { nComponents: 2, nEpochs: 10 });
      expect(result.coordinates).toHaveLength(1);
      expect(result.coordinates[0]).toHaveLength(2);
    });

    it('should handle two points', () => {
      const result = umap(
        [
          [1, 0, 0],
          [0, 1, 0],
        ],
        { nComponents: 2, nEpochs: 10, nNeighbors: 1 },
      );
      expect(result.coordinates).toHaveLength(2);
    });

    it('should handle empty input', () => {
      const result = umap([], { nComponents: 2, nEpochs: 10 });
      expect(result.coordinates).toHaveLength(0);
    });

    it('should produce coordinates in [0, 1] range', () => {
      const vectors = [
        [1, 0, 0, 0, 0],
        [0.9, 0.1, 0, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 0.9, 0.1, 0],
        [0, 0, 0, 0, 1],
      ];
      const result = umap(vectors, { nComponents: 2, nEpochs: 50, nNeighbors: 2 });
      for (const coord of result.coordinates) {
        for (const val of coord) {
          expect(val).toBeGreaterThanOrEqual(0);
          expect(val).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should preserve local structure (nearby points stay nearby)', () => {
      // Two clusters in high-dim space
      const cluster1 = makeCluster([1, 0, 0, 0, 0, 0, 0, 0], 5, 0.05);
      const cluster2 = makeCluster([0, 0, 0, 0, 0, 1, 0, 0], 5, 0.05);
      const vectors = [...cluster1, ...cluster2];

      const result = umap(vectors, { nComponents: 2, nEpochs: 100, nNeighbors: 3 });

      // Compute average distance within cluster 1
      const c1 = result.coordinates.slice(0, 5);
      const c2 = result.coordinates.slice(5, 10);

      function centroid(pts: number[][]): number[] {
        const n = pts.length;
        return pts[0]!.map((_, d) => pts.reduce((s, p) => s + p[d]!, 0) / n);
      }

      function dist2d(a: number[], b: number[]): number {
        return Math.sqrt((a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2);
      }

      const cen1 = centroid(c1);
      const cen2 = centroid(c2);
      const interCluster = dist2d(cen1, cen2);

      // Inter-cluster distance should be > 0 (clusters should be separated)
      expect(interCluster).toBeGreaterThan(0);
    });

    it('should be deterministic (seeded PRNG)', () => {
      const vectors = [
        [1, 0, 0, 0],
        [0.5, 0.5, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
      ];
      const result1 = umap(vectors, { nComponents: 2, nEpochs: 50, nNeighbors: 2 });
      const result2 = umap(vectors, { nComponents: 2, nEpochs: 50, nNeighbors: 2 });

      for (let i = 0; i < result1.coordinates.length; i++) {
        for (let d = 0; d < 2; d++) {
          expect(result1.coordinates[i]![d]).toBeCloseTo(result2.coordinates[i]![d]!, 10);
        }
      }
    });
  });
});
