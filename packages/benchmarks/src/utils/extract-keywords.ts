/**
 * Keyword extraction utility for grep-based benchmark comparisons.
 *
 * Extracts meaningful search terms from natural language queries by
 * removing stop words, preferring code identifiers (PascalCase/camelCase),
 * and joining with grep OR syntax.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'must',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'find', 'show', 'get', 'list', 'display', 'where', 'defined',
  'work', 'works', 'working', 'used', 'using', 'use',
  'does', 'happen', 'happens', 'between', 'each', 'other',
]);

/**
 * Extract keywords from a natural language query for grep.
 * Removes stop words and short words to get meaningful search terms.
 */
export function extractKeywords(query: string): string {
  const words = query
    .replace(/[?.,!]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));

  // If we have PascalCase/camelCase identifiers, prefer those
  const identifiers = words.filter((w) => /[A-Z]/.test(w));
  if (identifiers.length > 0) {
    return identifiers.join('\\|');
  }

  // Otherwise join top keywords with grep OR
  return words.slice(0, 3).join('\\|');
}
