# Backlog Grooming Report

**Date**: {{date}}

## Backlog Health

- Total items in backlog: {{total_items}}
- Items with story points: {{with_points}} / {{total_items}}
- Items with acceptance criteria: {{with_criteria}} / {{total_items}}
- Items assigned to iteration: {{with_iteration}} / {{total_items}}

## Items Missing Required Fields

{{#each incomplete_items}}
- **{{id}}**: {{title}}
  - Missing: {{missing_fields}}
{{/each}}

## Priority Review

### Ready for Sprint (fully groomed)
{{#each ready_items}}
- **{{id}}**: {{title}} ({{points}} SP, Priority: {{priority}})
{{/each}}

### Needs Refinement
{{#each needs_refinement}}
- **{{id}}**: {{title}} — {{reason}}
{{/each}}

## Suggested Actions

{{#each suggestions}}
- {{action}}
{{/each}}
