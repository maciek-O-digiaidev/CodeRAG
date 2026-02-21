# Daily Standup: {{date}}

## Active Work Items

{{#each active_items}}
### {{id}}: {{title}}
- **State**: {{state}}
- **Sprint**: {{iteration}}
- **Points**: {{points}}
{{/each}}

## Recent Commits (last 24h)

{{#each recent_commits}}
- `{{hash}}` {{message}} ({{time}})
{{/each}}

## Blockers

{{#each blockers}}
- {{description}}
{{/each}}

## Plan for Today

{{plan}}
