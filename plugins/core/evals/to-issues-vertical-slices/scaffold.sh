#!/usr/bin/env bash
# A PRD for Acme's quote cache, with a web UI, an API and a database behind it.
set -euo pipefail
mkdir -p .claude
cat > .claude/skrymer-ai.config.mjs <<'JS'
import { defineConfig } from 'skrymer-ai'

export default defineConfig({ tracker: { kind: 'local' } })
JS
mkdir -p docs/prd src/api src/db src/web
cat > docs/prd/quote-cache.md <<'MD'
# Quote cache

Acme's checkout calls Globex for a quote on every line, and Globex rate-limits us at peak.

## User stories

1. As a customer, I see a line's price at checkout without waiting for Globex when a fresh quote is cached.
2. As a customer, I am never charged a quote that has expired; an expired one is fetched again.
3. As an operator, I can see on the admin page how many checkouts were served from the cache today.

## Implementation notes

- Cached quotes live in a new `quotes` table (Postgres).
- The checkout API reads the cache before calling Globex.
- The admin page is part of the web app and reads a new stats endpoint.
MD
echo "// checkout API" > src/api/checkout.mjs
echo "-- schema" > src/db/schema.sql
echo "// admin page" > src/web/admin.mjs
