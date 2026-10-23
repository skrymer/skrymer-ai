---
type: tool_order
before: { tool: Write, input_match: '"file_path":"[^"]*test/shipping\.test\.mjs"' }
after: { tool: Write, input_match: '"file_path":"[^"]*src/shipping\.mjs"' }
---
