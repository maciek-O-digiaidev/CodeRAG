# Azure DevOps Backlog Rules — CodeRAG

## Organization & Project

- **Organization URL**: https://dev.azure.com/momc-pl
- **Project**: CodeRAG
- **Process**: Agile
- **Repository**: CodeRAG
- **MCP server**: `ado-momc` (@azure-devops/mcp)

## Work Item Hierarchy

```
Epic
 └── User Story
      └── Task
```

### Field Requirements by Type

**Epic**: Title, Description, Priority, Tags (Phase)
**User Story**: Title, Description, Acceptance Criteria, Story Points, Priority, Iteration, Tags (MVP/Phase)
**Task**: Title, Description, Remaining Work (hours), Activity Type, Iteration

## Story Point Scale

| Size | Points | Description |
|------|--------|-------------|
| S | 2 | Small — few hours, well-understood |
| M | 5 | Medium — 1-2 days, some complexity |
| L | 8 | Large — 3-5 days, significant complexity |
| XL | 13 | Extra Large — 1-2 weeks, high uncertainty |

## Priority Mapping

| Label | ADO Priority | Description |
|-------|-------------|-------------|
| P1 | 1 | Critical — blocks other work |
| P2 | 2 | High — important for sprint goal |
| P3 | 3 | Medium — nice to have in sprint |
| P4 | 4 | Low — backlog, do when capacity allows |

## Tags

- `MVP` — included in MVP scope
- `Phase-0` to `Phase-4` — development phase
- `blocked` — has external dependency or blocker
- `tech-debt` — technical debt item

## Work Item Lifecycle

```
New → Active → Resolved → Closed
         ↓
      Removed (if cancelled)
```

### State Transitions
- **New**: Created, not started
- **Active**: Work in progress, must have assignee and iteration
- **Resolved**: Implementation done, ready for review/testing
- **Closed**: Verified complete, acceptance criteria met

## Branch Convention

```
feature/AB#XXXX-short-description
bugfix/AB#XXXX-fix-description
```

The `AB#XXXX` pattern auto-links commits to ADO work items.

## Sprint Structure

- Sprint duration: 2 weeks
- Iteration path: `CodeRAG\Sprint N`
- Sprint numbering: sequential

## Areas

- `CodeRAG\Core` — core library (ingestion, embedding, retrieval)
- `CodeRAG\CLI` — CLI tool
- `CodeRAG\MCP` — MCP server
- `CodeRAG\Benchmarks` — benchmark suite
- `CodeRAG\Infrastructure` — CI/CD, tooling, environment
