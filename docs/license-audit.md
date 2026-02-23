# License Audit Report

**Project**: CodeRAG
**License**: MIT (SPDX: `MIT`)
**Date**: 2026-02-23
**Story**: AB#108

## License Choice

CodeRAG uses the **MIT License** for all packages. MIT was chosen because:

- Maximum permissiveness for both open-source and commercial use
- Widely adopted in the TypeScript/Node.js ecosystem
- Compatible with all dependency licenses in this project
- Minimal overhead for contributors and users

## LICENSE File Locations

| Path | Present |
|------|---------|
| `LICENSE` (root) | Yes |
| `packages/core/LICENSE` | Yes |
| `packages/cli/LICENSE` | Yes |
| `packages/mcp-server/LICENSE` | Yes |
| `packages/vscode-extension/LICENSE` | Yes |
| `packages/api-server/LICENSE` | Yes |
| `packages/viewer/LICENSE` | Yes |
| `packages/benchmarks/LICENSE` | Yes |

## package.json License Fields

All `package.json` files contain `"license": "MIT"` (valid SPDX identifier):

| Package | license field |
|---------|---------------|
| `coderag` (root) | `MIT` |
| `@coderag/core` | `MIT` |
| `@coderag/cli` | `MIT` |
| `@coderag/mcp-server` | `MIT` |
| `coderag-vscode` | `MIT` |
| `@coderag/api-server` | `MIT` |
| `@coderag/viewer` | `MIT` |
| `@coderag/benchmarks` | `MIT` |

## Production Dependency Licenses

All direct production dependencies have MIT-compatible licenses.

| Dependency | License | Used By |
|------------|---------|---------|
| `@lancedb/lancedb` | Apache-2.0 | core |
| `@modelcontextprotocol/sdk` | MIT | mcp-server |
| `@qdrant/js-client-rest` | Apache-2.0 | core |
| `chalk` | MIT | cli |
| `commander` | MIT | cli |
| `express` | MIT | api-server |
| `ignore` | MIT | core |
| `minisearch` | MIT | core |
| `neverthrow` | MIT | core |
| `ora` | MIT | cli |
| `simple-git` | MIT | core |
| `tree-sitter-wasms` | Unlicense | core |
| `web-tree-sitter` | MIT | core |
| `yaml` | ISC | core, cli |
| `zod` | MIT | core, mcp-server, api-server |

## Dev Dependency Licenses

All dev dependencies have MIT-compatible licenses.

| Dependency | License | Used By |
|------------|---------|---------|
| `@changesets/cli` | MIT | root |
| `@types/express` | MIT | api-server |
| `@types/node` | MIT | core, cli, mcp-server, vscode-extension, api-server, benchmarks |
| `@types/supertest` | MIT | api-server |
| `@types/vscode` | MIT | vscode-extension |
| `@vitest/coverage-v8` | MIT | core, cli, mcp-server, api-server, benchmarks |
| `esbuild` | MIT | vscode-extension |
| `eslint` | MIT | root |
| `jsdom` | MIT | viewer |
| `prettier` | MIT | root |
| `supertest` | MIT | api-server |
| `tsx` | MIT | benchmarks |
| `typescript` | Apache-2.0 | all packages |
| `typescript-eslint` | MIT | root |
| `vite` | MIT | viewer |
| `vitest` | MIT | all packages |

## License Compatibility Summary

| License | Count | Compatible with MIT? |
|---------|-------|---------------------|
| MIT | 27 | Yes (same license) |
| Apache-2.0 | 3 | Yes (permissive) |
| ISC | 1 | Yes (permissive, MIT-equivalent) |
| Unlicense | 1 | Yes (public domain dedication) |

**Result**: All 32 direct dependencies use permissive licenses fully compatible with MIT.
No GPL, AGPL, SSPL, EUPL, or other copyleft licenses found.

## Incompatible Licenses

None found.
