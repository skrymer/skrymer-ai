# The image `npm run evals` runs `claude plugin eval` in. Each case's Bash runs in Claude
# Code's sandbox: bwrap with --cap-drop ALL in a user namespace, and a nested user namespace
# for seccomp. Ubuntu's AppArmor user-namespace restriction denies that nested namespace its
# capabilities, on the host and in a container alike, and the eval runner never falls back
# to running Bash unsandboxed. run.sh starts the container under apparmor-profile, which
# allows user namespaces, as the operator's uid rather than root, and with an unmasked /proc
# for the sandbox to mount.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap socat git ca-certificates ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system safe.directory '*'

ARG CLAUDE_CODE_VERSION
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Any uid runs here, so the home is world-writable. run.sh mounts the login into .claude.
RUN mkdir -p -m 1777 /home/eval /home/eval/.claude
ENV HOME=/home/eval

WORKDIR /work
