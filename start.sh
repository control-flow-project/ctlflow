#!/bin/sh
set -eu
umask 077

checkout=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -eq 0 ]; then
  printf 'Usage: %s CONFIG_FILE [--compile]\n' "$0" >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js 26+ must be on PATH.\n' >&2
  exit 1
fi
exec node "$checkout/crossfire" start "$@"
