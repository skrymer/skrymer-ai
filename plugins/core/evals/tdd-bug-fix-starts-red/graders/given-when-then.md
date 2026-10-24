---
type: regex
target: { source: file, path: test/invoice.test.mjs }
match: not_contains
---
\b(test|it)\(.*\n(?![ \t]*// Given)
