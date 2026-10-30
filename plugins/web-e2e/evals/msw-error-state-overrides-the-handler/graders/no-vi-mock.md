---
type: regex
target: { source: file, path: src/profile-card.test.ts }
match: not_contains
---
vi\.(do)?[mM]ock\(|vi\.spyOn\([^)]*fetch|globalThis\.fetch\s*=
