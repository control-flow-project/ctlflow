#!/bin/sh
set -eu
socat TCP4-LISTEN:8080,bind=127.0.0.1,reuseaddr,fork TCP4:crossfire:8080 &
socat TCP4-LISTEN:8082,bind=127.0.0.1,reuseaddr,fork TCP4:crossfire:8082 &
exec "$@"
