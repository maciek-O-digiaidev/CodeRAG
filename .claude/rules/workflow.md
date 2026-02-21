# CodeRAG Development Workflow

This document defines the complete development process for CodeRAG.
All agents MUST follow this workflow. The process runs in continuous cycles.

## Roles & Agents

| Role | Agent | Responsibility |
|------|-------|---------------|
| Product Owner | `product-owner` | Backlog refinement, AC validation, product strategy |
| Architect | `architect` | Design review, ADRs, technical decisions |
| Scrum Master | `/scrum-master` skill | Sprint management, ADO sync, status tracking |
| Developer(s) | `developer` (x N, parallel worktrees) | Implementation, unit tests |
| Lead Developer | `lead-developer` | Code review, PR creation, merge, conflict resolution |
| Tester | `tester` | Test execution, coverage validation, AC verification |
| Reviewer | `reviewer` | Code quality review (pre-merge) |

## Process Overview

```
 CONTINUOUS ──────────────────────────────────────────────────
 │ PO: refinement + new ideas    Architect: design reviews   │
 ─────────────────────────────────────────────────────────────

 SPRINT CYCLE (2 weeks) ──────────────────────────────────────
 │                                                            │
 │  PLAN → DEVELOP → TEST → REVIEW → MERGE → SYNC → REPEAT  │
 │                                                            │
 ──────────────────────────────────────────────────────────────
```

## Phase 1: Sprint Planning

**Trigger**: Start of sprint or previous sprint completed
**Owner**: Scrum Master

1. `/scrum-master planning` — analyze velocity, propose scope
2. PO confirms sprint scope and priorities
3. SM assigns stories to iteration in ADO
4. SM sets story states to Active, assigns area paths
5. Architect reviews technical approach for complex stories

**Output**: Sprint backlog with assigned stories, ADO updated

## Phase 2: Parallel Development

**Trigger**: Sprint planned, stories assigned
**Owner**: Developer agents (parallel)

Each developer works independently in isolated worktree:

1. SM provides story details (ADO ID, AC, context)
2. Developer creates branch: `feature/AB#XXXX-description`
3. Developer implements with tests in worktree
4. Developer runs `pnpm test` and `pnpm build` locally
5. Developer commits with `AB#XXXX` in message

**Parallel streams** — up to N developers work simultaneously:
- Stream A: `developer` → Story from EPIC 1 (e.g., ingestion)
- Stream B: `developer` → Story from EPIC 2 (e.g., embedding)
- Streams should be on independent code areas to minimize conflicts

**Output**: Feature branches with implementation + tests

## Phase 3: Test & Validate

**Trigger**: Developer signals implementation complete
**Owner**: Tester + Product Owner

1. Tester runs full test suite on feature branch
2. Tester validates each AC item against tests
3. Tester produces Test Report (PASS/FAIL)
4. PO validates deliverable against acceptance criteria
5. PO produces AC Validation Report (ACCEPT/REJECT)

**If FAIL or REJECT**:
- Developer receives feedback
- Developer fixes issues in same worktree
- Return to step 1 of this phase (iterate until PASS + ACCEPT)

**Output**: Test Report + AC Validation, both passing

## Phase 4: Review & Merge

**Trigger**: Tester PASS + PO ACCEPT
**Owner**: Reviewer + Lead Developer

1. Reviewer performs code review (quality, security, conventions)
2. Architect reviews if story touches architecture (new providers, APIs)
3. If REQUEST CHANGES: Developer fixes, return to Phase 3
4. If APPROVE: Lead Developer takes over
5. Lead Developer creates PR in ADO
6. Lead Developer merges to main (squash merge)
7. Lead Developer resolves any conflicts with other parallel streams
8. Lead Developer runs integration tests on main after merge
9. If multiple streams: merge in dependency order (core → CLI → MCP)

**Output**: Code merged to main, PR linked to AB#XXXX

## Phase 5: ADO Sync & Status

**Trigger**: Code merged to main
**Owner**: Scrum Master

1. `/scrum-master sync` — detect merged branches, update ADO states
2. Merged stories: state → Resolved
3. Tested + validated stories: state → Closed (after PO final check)
4. `/scrum-master status` — sprint progress report
5. Identify blocked or at-risk items

**Output**: ADO updated, sprint status report

## Phase 6: Next Cycle

**Decision point**: Are there more stories in the sprint?
- **YES**: Return to Phase 2 with next stories
- **NO**: `/scrum-master review` — sprint review/retro
  - Calculate velocity
  - Identify carry-overs
  - Move incomplete to next sprint
  - Start Phase 1 for next sprint

## Continuous Processes (parallel with sprint cycle)

### Backlog Refinement (PO + Architect)
- Runs continuously, independent of sprint cycle
- PO refines upcoming stories (2 sprints ahead)
- Architect reviews technical feasibility
- PO writes/updates acceptance criteria
- Flag stories needing spike/research
- Output: Groomed backlog ready for sprint planning

### Product Innovation (PO)
- Analyze market trends and competitor tools
- Propose new features/epics
- Key ideas to explore:
  - Always-current documentation via agent
  - Auto-updating RAG on every code change (MVP: stories 1.5 + 1.6)
  - Multi-agent collaboration context sharing
  - IDE-native integrations beyond VS Code
  - Team-wide shared context (cloud features)
- Output: Product Idea Briefs for backlog

### Technical Debt & Architecture (Architect)
- Monitor code quality trends
- Propose refactoring when patterns emerge
- Update ADRs when decisions change
- Review cross-cutting concerns (security, performance)

## Handoff Points

| From | To | Handoff | Signal |
|------|----|---------|--------|
| SM | Developer | Sprint planned | Stories assigned in ADO, state: Active |
| Developer | Tester | Implementation done | Branch pushed, commit with AB#XXXX |
| Developer | PO | Implementation done | Request AC validation |
| Tester | Developer | Tests fail | Test Report with FAIL verdict |
| PO | Developer | AC not met | AC Validation with REJECT verdict |
| Tester+PO | Reviewer | Tests pass + AC met | PASS + ACCEPT signals |
| Reviewer | Lead Dev | Code approved | APPROVE verdict |
| Reviewer | Developer | Changes needed | REQUEST CHANGES verdict |
| Lead Dev | SM | Code merged | PR merged to main |
| SM | All | Sprint complete | Sprint review report |

## Branch Strategy

```
main (protected)
├── feature/AB#32-tree-sitter-integration    (Developer A worktree)
├── feature/AB#39-embedding-provider         (Developer B worktree)
├── feature/AB#48-mcp-server-core            (Developer C worktree)
└── bugfix/AB#XX-fix-description             (hotfix)
```

- Feature branches from main, merge back to main
- Squash merge for features (clean history)
- No direct commits to main
- AB#XXXX in all commit messages for ADO linking

## MVP Auto-Update Requirement

The RAG index MUST update automatically when code changes. This is covered by:
- **AB#36** (US-1.5): Git Integration & File Watcher — detects changes
- **AB#37** (US-1.6): Incremental Re-indexing Engine — updates index

Both are MVP stories in Sprint 1. Implementation approach:
1. File watcher detects git changes (commit, checkout, pull)
2. Compute file hashes, compare with indexed state
3. Re-parse, re-chunk, re-embed only changed files
4. Update LanceDB and BM25 index incrementally
5. Update dependency graph for affected nodes
