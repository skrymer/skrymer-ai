#!/usr/bin/env bash
# The artifacts a session on Acme's quote cache left behind.
set -euo pipefail
mkdir -p .claude
cat > .claude/skrymer-ai.config.mjs <<'JS'
import { defineConfig } from 'skrymer-ai'

export default defineConfig({ tracker: { kind: 'local' } })
JS
mkdir -p docs/prd docs/adr .scratch/quote-cache/issues
cat > docs/prd/quote-cache.md <<'MD'
# Quote cache

Cache Globex quotes so checkout makes fewer calls. A cached quote is charged only until its expiry.
MD
cat > docs/adr/0001-cache-quotes-in-postgres.md <<'MD'
# Cache quotes in Postgres

Quotes are cached in a `quotes` table rather than in Redis, because checkout already runs in a Postgres transaction and the cache must agree with it.
MD
cat > .scratch/quote-cache/issues/01-serve-a-fresh-quote-from-the-cache.md <<'MD'
# Serve a fresh quote from the cache

Status: done
MD
cat > .scratch/quote-cache/issues/02-refetch-an-expired-quote.md <<'MD'
# Refetch an expired quote

Status: ready-for-agent
Blocked by: 01
MD
