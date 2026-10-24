#!/usr/bin/env bash
# Runs core's skill evals in a container, on the operator's Claude login. Extra arguments go
# to `claude plugin eval`, for example `--tag tdd`. Needs the container's AppArmor
# profile loaded once per boot: sudo apparmor_parser -r scripts/evals/apparmor-profile
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
version=$(claude --version | cut -d' ' -f1)
image=skrymer-ai-evals:$version
credentials=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json

if [[ ! -f $credentials ]]; then
  echo "evals: no Claude login at $credentials. Run \`claude\` and /login first." >&2
  exit 1
fi

docker build --quiet --build-arg CLAUDE_CODE_VERSION="$version" -t "$image" "$repo/scripts/evals" >/dev/null

# As the operator, so results are theirs and the sandbox's nested user namespace never maps
# root, which needs CAP_SETFCAP.
exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  --security-opt seccomp=unconfined --security-opt apparmor=skrymer-ai-evals --security-opt systempaths=unconfined \
  -v "$repo:/work" \
  -v "$credentials:/home/eval/.claude/.credentials.json" \
  "$image" \
  claude plugin eval plugins/core \
    --ablation none --no-publish --trust-plugin --scaffold \
    --allow-tools Write Edit Bash \
    --model claude-sonnet-5-5 --judge-model claude-opus-5-5 \
    --threshold 0.8 --max-cost-usd 15 \
    "$@"
