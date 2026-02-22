/**
 * Scans source code content for ClickUp task references.
 *
 * Extracts all `CU-XXXXX` and `#XXXXX` patterns found in the given content
 * string and returns an array of task ID strings (with prefix).
 *
 * @param content - The source code or text content to scan
 * @returns An array of ClickUp task reference strings (e.g., ["CU-abc123", "#12345"])
 */
export function scanForClickUpReferences(content: string): string[] {
  // Match CU-<alphanumeric> or #<alphanumeric> patterns
  const pattern = /(?:CU-([a-zA-Z0-9]+)|#([a-zA-Z0-9]+))/g;
  const refs: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    // CU-XXXXX match is in group 1, #XXXXX match is in group 2
    const cuRef = match[1];
    const hashRef = match[2];

    let ref: string;
    if (cuRef !== undefined) {
      ref = `CU-${cuRef}`;
    } else {
      ref = `#${hashRef!}`;
    }

    // Avoid duplicates while preserving first-occurrence order
    if (!refs.includes(ref)) {
      refs.push(ref);
    }
  }

  return refs;
}
