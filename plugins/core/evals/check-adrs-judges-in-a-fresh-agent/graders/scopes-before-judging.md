---
type: tool_order
before: { tool: Bash, input_match: 'adr-scope\.mjs' }
after: { tool: Agent, input_match: '"subagent_type":"[^"]*check-adrs"' }
---
