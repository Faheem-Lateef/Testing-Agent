#!/usr/bin/env bash
# Logs when the QA agent CLI finishes a full run (for Hooks output channel).
set -euo pipefail
input=$(cat)

if echo "$input" | grep -qE 'tsx src/index\.ts run|node dist/index\.js run'; then
  echo '{"additional_context":"QA run command finished. Check console for [EVOLUTION] lines if self-improvement was enabled."}'
fi

exit 0
