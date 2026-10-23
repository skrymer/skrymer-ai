#!/usr/bin/env bash
# Acme's glossary, where an Estimate is never what a customer pays.
set -euo pipefail
mkdir -p .claude
cat > .claude/skrymer-ai.config.mjs <<'JS'
import { defineConfig } from 'skrymer-ai'

export default defineConfig({ tracker: { kind: 'local' } })
JS
mkdir -p docs/adr
cat > CONTEXT.md <<'MD'
# Acme ordering

## Language

**Quote**:
A price Globex guarantees for one SKU until the quote's expiry.
_Avoid_: offer

**Estimate**:
A price shown while a customer browses. It is never charged; checkout always charges a Quote.
_Avoid_: guide price

**Order**:
The lines a customer checks out, each charged at a Quote.
MD
