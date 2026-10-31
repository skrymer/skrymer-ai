---
type: regex
target: { source: file, path: .git/skrymer-ai/verify/12/results.tsv }
match: contains
---
EX-12\.2\t[a-z-]+\t(pass|fail|blocked)\t
