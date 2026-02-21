# Sprint Planning: {{next_sprint_name}}

**Date**: {{date}}
**Previous Sprint**: {{previous_sprint}}

## Previous Sprint Review

- Planned: {{prev_planned_points}} story points
- Completed: {{prev_completed_points}} story points
- Completion rate: {{prev_completion_rate}}%
- Carry-over items: {{carry_over_count}}

## Team Velocity

- Last 3 sprints average: {{velocity}} story points/sprint
- Trend: {{velocity_trend}}

## Carry-over Items

{{#each carry_over_items}}
- **{{id}}**: {{title}} ({{points}} SP) — {{state}}
{{/each}}

## Proposed Sprint Scope

**Target**: {{target_points}} story points

### High Priority
{{#each high_priority}}
- **{{id}}**: {{title}} ({{points}} SP)
{{/each}}

### Medium Priority
{{#each medium_priority}}
- **{{id}}**: {{title}} ({{points}} SP)
{{/each}}

### Stretch Goals
{{#each stretch}}
- **{{id}}**: {{title}} ({{points}} SP)
{{/each}}
