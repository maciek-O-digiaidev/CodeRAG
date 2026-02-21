# Sprint Status: {{sprint_name}}

**Date**: {{date}}
**Sprint**: {{iteration_path}}

## Summary

| State | Count | Story Points |
|-------|-------|-------------|
| New | {{new_count}} | {{new_points}} |
| Active | {{active_count}} | {{active_points}} |
| Resolved | {{resolved_count}} | {{resolved_points}} |
| Closed | {{closed_count}} | {{closed_points}} |
| **Total** | **{{total_count}}** | **{{total_points}}** |

## Completion Rate

{{completion_percentage}}% ({{completed_points}}/{{total_points}} story points)

## Active Items

{{#each active_items}}
- **{{id}}**: {{title}} ({{assigned_to}}) — {{days_active}} days active
{{/each}}

## Blockers

{{#each blockers}}
- **{{id}}**: {{title}} — {{reason}}
{{/each}}

## Items at Risk

{{#each at_risk}}
- **{{id}}**: {{title}} — {{risk_reason}}
{{/each}}
