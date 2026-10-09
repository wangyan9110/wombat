#!/bin/sh
# No model context or permission decisions are returned by this advisory bridge.
if [ -x "$HOME/.local/bin/wombat" ] && [ -f "$HOME/.local/lib/wombat/.managed-by-wombat" ]; then
  "$HOME/.local/bin/wombat" hook codex >/dev/null
elif command -v wombat >/dev/null 2>&1; then
  wombat hook codex >/dev/null
else
  echo 'Wombat: local runtime unavailable; collection was skipped.' >&2
fi
exit 0
