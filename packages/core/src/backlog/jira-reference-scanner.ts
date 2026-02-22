/**
 * Scans source code content for Jira issue key references (e.g., PROJECT-123).
 *
 * Extracts all `UPPER-digits` patterns found in the given content string
 * and returns an array of the full issue keys as strings.
 *
 * @param content - The source code or text content to scan
 * @param projectKey - Optional project key to restrict matches (e.g., "PROJ")
 * @returns An array of Jira issue key strings (e.g., ["PROJ-123", "CORE-456"])
 */
export function scanForJiraReferences(
  content: string,
  projectKey?: string,
): string[] {
  const pattern = projectKey
    ? new RegExp(`\\b${projectKey}-(\\d+)\\b`, 'g')
    : /\b([A-Z][A-Z0-9_]+-\d+)\b/g;

  const keys: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    // When projectKey is provided, reconstruct the full key from the captured number
    const key = projectKey ? `${projectKey}-${match[1]!}` : match[1]!;
    // Avoid duplicates while preserving first-occurrence order
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys;
}
