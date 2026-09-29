#!/bin/sh
set -eu
umask 077
checkout=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$checkout/crossfire" start "$@"
