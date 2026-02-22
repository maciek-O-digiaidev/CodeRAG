import { describe, it, expect } from 'vitest';
import {
  MarkdownParser,
  parseFrontmatter,
  extractWikilinks,
  extractTags,
} from './markdown-parser.js';

describe('MarkdownParser', () => {
  describe('parseFrontmatter', () => {
    it('should parse simple key-value frontmatter', () => {
      const content = `---
title: My Document
author: John
---
# Hello`;

      const { frontmatter, bodyStartLine } = parseFrontmatter(content);

      expect(frontmatter.title).toBe('My Document');
      expect(frontmatter.raw['author']).toBe('John');
      expect(bodyStartLine).toBe(4);
    });

    it('should parse tags as array', () => {
      const content = `---
title: Tagged Doc
tags:
  - javascript
  - typescript
  - react
---
Content here`;

      const { frontmatter } = parseFrontmatter(content);

      expect(frontmatter.tags).toEqual(['javascript', 'typescript', 'react']);
    });

    it('should parse inline array tags', () => {
      const content = `---
tags: [javascript, typescript, react]
---
Content`;

      const { frontmatter } = parseFrontmatter(content);

      expect(frontmatter.tags).toEqual(['javascript', 'typescript', 'react']);
    });

    it('should parse aliases', () => {
      const content = `---
title: Main Doc
aliases:
  - doc-alias
  - another-name
---
Content`;

      const { frontmatter } = parseFrontmatter(content);

      expect(frontmatter.aliases).toEqual(['doc-alias', 'another-name']);
    });

    it('should return empty frontmatter when no delimiters found', () => {
      const content = `# Just a heading
Some content`;

      const { frontmatter, bodyStartLine } = parseFrontmatter(content);

      expect(frontmatter.title).toBeUndefined();
      expect(frontmatter.tags).toBeUndefined();
      expect(frontmatter.raw).toEqual({});
      expect(bodyStartLine).toBe(0);
    });

    it('should return empty frontmatter when only opening delimiter', () => {
      const content = `---
title: Broken
# No closing delimiter`;

      const { frontmatter, bodyStartLine } = parseFrontmatter(content);

      expect(frontmatter.raw).toEqual({});
      expect(bodyStartLine).toBe(0);
    });

    it('should handle quoted values', () => {
      const content = `---
title: "Quoted Title"
description: 'Single Quoted'
---
Content`;

      const { frontmatter } = parseFrontmatter(content);

      expect(frontmatter.title).toBe('Quoted Title');
      expect(frontmatter.raw['description']).toBe('Single Quoted');
    });

    it('should handle empty frontmatter block', () => {
      const content = `---
---
Content`;

      const { frontmatter, bodyStartLine } = parseFrontmatter(content);

      expect(frontmatter.raw).toEqual({});
      expect(bodyStartLine).toBe(2);
    });
  });

  describe('extractWikilinks', () => {
    it('should extract simple wikilinks', () => {
      const content = 'See [[Document A]] and [[Document B]] for details.';
      const links = extractWikilinks(content);

      expect(links).toEqual(['Document A', 'Document B']);
    });

    it('should extract wikilinks with display text', () => {
      const content = 'Check [[actual-page|displayed text]] here.';
      const links = extractWikilinks(content);

      expect(links).toEqual(['actual-page']);
    });

    it('should deduplicate wikilinks', () => {
      const content = '[[PageA]] and [[PageA]] again and [[PageB]].';
      const links = extractWikilinks(content);

      expect(links).toEqual(['PageA', 'PageB']);
    });

    it('should return empty array when no wikilinks', () => {
      const content = 'Just regular [markdown](link) here.';
      const links = extractWikilinks(content);

      expect(links).toEqual([]);
    });

    it('should handle wikilinks with paths', () => {
      const content = 'See [[folder/subfolder/doc]] for more.';
      const links = extractWikilinks(content);

      expect(links).toEqual(['folder/subfolder/doc']);
    });
  });

  describe('extractTags', () => {
    it('should extract hashtags from content', () => {
      const content = 'This is about #javascript and #typescript.';
      const tags = extractTags(content);

      expect(tags).toEqual(['javascript', 'typescript']);
    });

    it('should not extract headings as tags', () => {
      const content = `# Heading 1
## Heading 2
Some text with #real-tag here.`;
      const tags = extractTags(content);

      // Headings should not be treated as tags because they have space after #
      expect(tags).toEqual(['real-tag']);
    });

    it('should not extract tags from code blocks', () => {
      const content = `Some text #real-tag

\`\`\`javascript
const color = '#ff0000';
\`\`\`

More text #another-tag`;
      const tags = extractTags(content);

      expect(tags).toContain('real-tag');
      expect(tags).toContain('another-tag');
      expect(tags).not.toContain('ff0000');
    });

    it('should not extract tags from inline code', () => {
      const content = 'Use `#selector` in CSS. But #real-tag is here.';
      const tags = extractTags(content);

      expect(tags).toEqual(['real-tag']);
    });

    it('should deduplicate tags', () => {
      const content = '#tag1 and #tag1 and #tag2';
      const tags = extractTags(content);

      expect(tags).toEqual(['tag1', 'tag2']);
    });

    it('should handle tags with slashes and dots', () => {
      const content = 'Tagged with #project/subtopic and #v2.0';
      const tags = extractTags(content);

      expect(tags).toContain('project/subtopic');
      expect(tags).toContain('v2.0');
    });

    it('should return empty array when no tags', () => {
      const content = 'Just plain text without any tags.';
      const tags = extractTags(content);

      expect(tags).toEqual([]);
    });
  });

  describe('MarkdownParser.isMarkdownFile', () => {
    it('should recognize .md files', () => {
      expect(MarkdownParser.isMarkdownFile('README.md')).toBe(true);
    });

    it('should recognize .mdx files', () => {
      expect(MarkdownParser.isMarkdownFile('component.mdx')).toBe(true);
    });

    it('should recognize .markdown files', () => {
      expect(MarkdownParser.isMarkdownFile('guide.markdown')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(MarkdownParser.isMarkdownFile('README.MD')).toBe(true);
      expect(MarkdownParser.isMarkdownFile('notes.Md')).toBe(true);
    });

    it('should reject non-markdown files', () => {
      expect(MarkdownParser.isMarkdownFile('script.ts')).toBe(false);
      expect(MarkdownParser.isMarkdownFile('style.css')).toBe(false);
      expect(MarkdownParser.isMarkdownFile('data.json')).toBe(false);
    });
  });

  describe('MarkdownParser.parse', () => {
    const parser = new MarkdownParser();

    it('should parse empty content', () => {
      const result = parser.parse('empty.md', '');

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.chunks).toHaveLength(0);
      expect(parsed.sections).toHaveLength(0);
    });

    it('should parse whitespace-only content', () => {
      const result = parser.parse('whitespace.md', '   \n  \n  ');

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.chunks).toHaveLength(0);
    });

    it('should parse simple document with headings', () => {
      const content = `# Introduction

This is the intro paragraph.

## Details

Here are the details.

## Conclusion

Final thoughts.`;

      const result = parser.parse('doc.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.chunks.length).toBeGreaterThanOrEqual(3);

      // All chunks should have type 'doc'
      for (const chunk of parsed.chunks) {
        expect(chunk.metadata.chunkType).toBe('doc');
      }

      // All chunks should have language 'markdown'
      for (const chunk of parsed.chunks) {
        expect(chunk.language).toBe('markdown');
      }
    });

    it('should parse document with frontmatter', () => {
      const content = `---
title: Architecture Guide
tags:
  - architecture
  - design
aliases:
  - arch-guide
---

# Architecture

This document describes the architecture.`;

      const result = parser.parse('arch.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.frontmatter.title).toBe('Architecture Guide');
      expect(parsed.frontmatter.tags).toEqual(['architecture', 'design']);
      expect(parsed.frontmatter.aliases).toEqual(['arch-guide']);

      // Chunks should include frontmatter metadata
      expect(parsed.chunks.length).toBeGreaterThan(0);
      const chunk = parsed.chunks[0]!;
      expect(chunk.metadata.tags).toContain('architecture');
      expect(chunk.metadata.aliases).toEqual(['arch-guide']);
      expect(chunk.metadata.docTitle).toBe('Architecture Guide');
    });

    it('should extract wikilinks from content and store in metadata', () => {
      const content = `# References

See [[API Guide]] and [[Setup Instructions|setup]] for more info.

Also check [[API Guide]] again.`;

      const result = parser.parse('refs.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.chunks.length).toBeGreaterThan(0);

      const chunk = parsed.chunks[0]!;
      expect(chunk.metadata.links).toContain('API Guide');
      expect(chunk.metadata.links).toContain('Setup Instructions');
    });

    it('should extract tags from content and store in metadata', () => {
      const content = `# Development

Working with #typescript and #nodejs.

Remember #best-practices.`;

      const result = parser.parse('dev.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.chunks.length).toBeGreaterThan(0);

      const chunk = parsed.chunks[0]!;
      expect(chunk.metadata.tags).toContain('typescript');
      expect(chunk.metadata.tags).toContain('nodejs');
      expect(chunk.metadata.tags).toContain('best-practices');
    });

    it('should merge frontmatter tags with inline tags', () => {
      const content = `---
tags:
  - guide
---

# Section

Content with #inline-tag here.`;

      const result = parser.parse('merged.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      const chunk = parsed.chunks[0]!;
      expect(chunk.metadata.tags).toContain('guide');
      expect(chunk.metadata.tags).toContain('inline-tag');
    });

    it('should handle document without headings', () => {
      const content = `Just a simple document without any headings.

It has multiple paragraphs.

And references to [[Other Doc]].`;

      const result = parser.parse('simple.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.chunks.length).toBeGreaterThan(0);
      expect(parsed.chunks[0]!.metadata.name).toBe('(document)');
    });

    it('should handle code blocks in markdown', () => {
      const content = `# Usage

Here is how to use it:

\`\`\`typescript
const parser = new MarkdownParser();
const result = parser.parse('file.md', content);
\`\`\`

And another example:

\`\`\`python
print("hello world")
\`\`\``;

      const result = parser.parse('usage.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.sections.length).toBeGreaterThan(0);

      // The section should have detected code blocks
      const section = parsed.sections[0]!;
      expect(section.codeBlocks.length).toBe(2);
      expect(section.codeBlocks[0]!.language).toBe('typescript');
      expect(section.codeBlocks[1]!.language).toBe('python');
    });

    it('should use heading as chunk name', () => {
      const content = `# My Feature

Description of the feature.

## Implementation

Details about implementation.`;

      const result = parser.parse('feature.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();

      const names = parsed.chunks.map((c) => c.metadata.name);
      expect(names).toContain('My Feature');
      expect(names).toContain('Implementation');
    });

    it('should use frontmatter title as fallback name', () => {
      const content = `---
title: API Reference
---

This document has no headings but has a title in frontmatter.`;

      const result = parser.parse('api.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.chunks[0]!.metadata.name).toBe('API Reference');
    });

    it('should set correct file path on chunks', () => {
      const content = `# Test

Some content.`;
      const filePath = '/docs/test-file.md';

      const result = parser.parse(filePath, content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      for (const chunk of parsed.chunks) {
        expect(chunk.filePath).toBe(filePath);
      }
    });

    it('should generate unique chunk IDs', () => {
      const content = `# Section A

Content A.

## Section B

Content B.

## Section C

Content C.`;

      const result = parser.parse('doc.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      const ids = parsed.chunks.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should handle deeply nested headings', () => {
      const content = `# H1

## H2

### H3

#### H4

##### H5

###### H6

Content at level 6.`;

      const result = parser.parse('nested.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.sections.length).toBe(6);
    });

    it('should handle Obsidian-style document with mixed features', () => {
      const content = `---
title: Project Notes
tags: [project, notes]
aliases:
  - proj-notes
---

# Project Overview

This project uses [[TypeScript]] and [[Node.js]].

## Key Features #important

- Feature 1: See [[Feature 1 Doc]]
- Feature 2: Related to #backend
- Feature 3: Uses [[API Layer|API]]

## Code Example

\`\`\`typescript
export function hello(): string {
  return 'hello';
}
\`\`\``;

      const result = parser.parse('project.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();

      // Should have frontmatter
      expect(parsed.frontmatter.title).toBe('Project Notes');
      expect(parsed.frontmatter.tags).toEqual(['project', 'notes']);
      expect(parsed.frontmatter.aliases).toEqual(['proj-notes']);

      // Should have multiple sections
      expect(parsed.sections.length).toBe(3);

      // All chunks should be 'doc' type
      for (const chunk of parsed.chunks) {
        expect(chunk.metadata.chunkType).toBe('doc');
      }

      // Check wikilinks are extracted
      const allLinks = parsed.sections.flatMap((s) => s.wikilinks);
      expect(allLinks).toContain('TypeScript');
      expect(allLinks).toContain('Node.js');
      expect(allLinks).toContain('Feature 1 Doc');
      expect(allLinks).toContain('API Layer');
    });

    it('should handle lists grouped under headings', () => {
      const content = `# Todo List

- Item 1
- Item 2
  - Sub-item 2a
  - Sub-item 2b
- Item 3

## Completed

1. Done A
2. Done B`;

      const result = parser.parse('todo.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();

      // Lists should be part of their parent heading's chunk
      expect(parsed.chunks.length).toBeGreaterThanOrEqual(2);
      const todoChunk = parsed.chunks.find((c) => c.metadata.name === 'Todo List');
      expect(todoChunk).toBeDefined();
      expect(todoChunk!.content).toContain('Item 1');
      expect(todoChunk!.content).toContain('Sub-item 2a');
    });

    it('should set nlSummary to empty string', () => {
      const content = `# Test

Content.`;

      const result = parser.parse('test.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      for (const chunk of parsed.chunks) {
        expect(chunk.nlSummary).toBe('');
      }
    });

    it('should set empty arrays for declarations, imports, exports in metadata', () => {
      const content = `# Test

Content.`;

      const result = parser.parse('test.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      for (const chunk of parsed.chunks) {
        expect(chunk.metadata.declarations).toEqual([]);
        expect(chunk.metadata.imports).toEqual([]);
        expect(chunk.metadata.exports).toEqual([]);
      }
    });
  });

  describe('MarkdownParser with custom config', () => {
    it('should split large sections when exceeding maxTokensPerChunk', () => {
      const parser = new MarkdownParser({ maxTokensPerChunk: 50 });

      // Create content that exceeds 50 tokens (50 * 4 = 200 characters)
      const longParagraph = 'This is a fairly long paragraph that should exceed the token limit. '.repeat(5);
      const content = `# Large Section

${longParagraph}

Another paragraph here for good measure with some extra text.

Yet another paragraph to push us over the limit.`;

      const result = parser.parse('large.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      // Should have been split into multiple chunks
      expect(parsed.chunks.length).toBeGreaterThan(1);
    });
  });

  describe('Edge cases', () => {
    const parser = new MarkdownParser();

    it('should handle document with only frontmatter', () => {
      const content = `---
title: Empty Body
tags: [test]
---`;

      const result = parser.parse('frontmatter-only.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.frontmatter.title).toBe('Empty Body');
      expect(parsed.chunks).toHaveLength(0);
    });

    it('should handle document with only a heading', () => {
      const content = `# Just a Heading`;

      const result = parser.parse('heading-only.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.chunks.length).toBe(1);
      expect(parsed.chunks[0]!.metadata.name).toBe('Just a Heading');
    });

    it('should handle consecutive headings without content', () => {
      const content = `# H1

## H2

## H3`;

      const result = parser.parse('consecutive.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      // Each heading becomes its own section
      expect(parsed.sections.length).toBe(3);
    });

    it('should handle special characters in headings', () => {
      const content = `# What's new in v2.0?

Details here.

## Bug fixes & improvements

More details.`;

      const result = parser.parse('special.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      const names = parsed.chunks.map((c) => c.metadata.name);
      expect(names).toContain("What's new in v2.0?");
      expect(names).toContain('Bug fixes & improvements');
    });

    it('should handle frontmatter with complex values', () => {
      const content = `---
title: Complex
date: 2024-01-15
draft: false
tags: [a, b, c]
---

# Content`;

      const { frontmatter } = parseFrontmatter(content);

      expect(frontmatter.title).toBe('Complex');
      expect(frontmatter.raw['date']).toBe('2024-01-15');
      expect(frontmatter.raw['draft']).toBe('false');
      expect(frontmatter.tags).toEqual(['a', 'b', 'c']);
    });

    it('should handle content before first heading', () => {
      const content = `Some introductory text before any heading.

# First Heading

Content under heading.`;

      const result = parser.parse('pre-heading.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      // Should have 2 sections: pre-heading content + heading section
      expect(parsed.sections.length).toBe(2);
    });

    it('should handle wikilinks in frontmatter-less doc', () => {
      const content = `This links to [[SomePage]] and [[Other/Page]].`;

      const result = parser.parse('links.md', content);

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.chunks[0]!.metadata.links).toContain('SomePage');
      expect(parsed.chunks[0]!.metadata.links).toContain('Other/Page');
    });
  });
});
