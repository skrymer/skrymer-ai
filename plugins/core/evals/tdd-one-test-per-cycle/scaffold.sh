#!/usr/bin/env bash
# An empty Node project for Globex's shipping rules.
set -euo pipefail
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "globex-shipping", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
