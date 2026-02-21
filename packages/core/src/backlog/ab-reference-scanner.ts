/**
 * Scans source code content for Azure DevOps AB#XXXX work item references.
 *
 * Extracts all `AB#<number>` patterns found in the given content string
 * and returns an array of the numeric ID parts as strings.
 *
 * @param content - The source code or text content to scan
 * @returns An array of work item ID strings (e.g., ["123", "456"])
 */
export function scanForABReferences(content: string): string[] {
  const pattern = /AB#(\d+)/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const id = match[1]!;
    // Avoid duplicates while preserving first-occurrence order
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}
