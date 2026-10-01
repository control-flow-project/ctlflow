#!/usr/bin/env bash
set -euo pipefail

client_arguments=("$@")
server_arguments=()
cwd_arguments=(--cd "$PWD")
permission_override=false
session_action=
positional_seen=false
sandbox_mode=
approval_policy=
auto_review=false
bypass=false

argument_error() { printf 'runcodex.sh: %s\n' "$*" >&2; exit 2; }

while (($#)); do
  argument=$1
  shift
  option=$argument
  attached=false
  value=
  case $argument in
    --) break ;;
    --*=*) option=${argument%%=*}; value=${argument#*=}; attached=true ;;
    -[samCcip]?*) option=${argument:0:2}; value=${argument:2}; value=${value#=}; attached=true ;;
  esac
  case $option in
    -s|--sandbox|-a|--ask-for-approval|-c|--config|-C|--cd|-m|--model|-p|--profile|-i|--image|--add-dir|--enable|--disable|--local-provider|--remote|--remote-auth-token-env)
      if ! $attached; then
        (($#)) || argument_error "$option requires a value"
        value=$1
        shift
      fi
      case $option in
        -s|--sandbox)
          case $value in read-only|workspace-write|danger-full-access) ;; *) argument_error "Invalid sandbox: $value" ;; esac
          sandbox_mode=$value
          permission_override=true
          ;;
        -a|--ask-for-approval)
          case $value in on-request|never) ;; *) argument_error "Invalid approval policy: $value" ;; esac
          approval_policy=$value
          permission_override=true
          ;;
        -c|--config)
          key=${value%%=*}
          key=${key%%.*}
          key=${key//[[:space:]\"\']/}
          case $key in
            approval_policy|approvals_reviewer|sandbox_mode|default_permissions|permissions|network|sandbox_workspace_write)
              permission_override=true
              server_arguments+=(-c "$value")
              ;;
          esac
          ;;
        -C|--cd) cwd_arguments=() ;;
        -i|--image)
          if ! $attached; then
            while (($#)) && [[ $1 != -* ]]; do shift; done
          fi
          ;;
        --add-dir) permission_override=true ;;
        --remote|--remote-auth-token-env) argument_error "$option is managed by runcodex.sh" ;;
      esac
      ;;
    --dangerously-bypass-approvals-and-sandbox|--yolo) bypass=true; permission_override=true ;;
    --approve-for-me|--not-so-yolo) auto_review=true; permission_override=true ;;
    -*) ;;
    *)
      if ! $positional_seen; then
        positional_seen=true
        case $argument in resume|fork) session_action=$argument ;; esac
      fi
      ;;
  esac
done

if [[ -n $session_action ]] && $permission_override; then
  argument_error "Permission overrides are not supported with remote $session_action. Run runcodex.sh $session_action without permission options; specify permissions when creating a new session."
fi
if $auto_review; then
  if $bypass || [[ -n $sandbox_mode || -n $approval_policy ]]; then
    argument_error '--approve-for-me cannot be combined with sandbox or approval options'
  fi
  server_arguments+=(-c 'approvals_reviewer="auto_review"' -c 'approval_policy="on-request"' -c 'sandbox_mode="workspace-write"')
fi
if $bypass; then
  [[ -z $approval_policy ]] || argument_error '--dangerously-bypass-approvals-and-sandbox cannot be combined with --ask-for-approval'
  sandbox_mode=danger-full-access
  approval_policy=never
fi
if [[ -n $sandbox_mode ]]; then server_arguments+=(-c "sandbox_mode=\"$sandbox_mode\""); fi
if [[ -n $approval_policy ]]; then server_arguments+=(-c "approval_policy=\"$approval_policy\""); fi

for dependency in codex curl od; do
  command -v "$dependency" >/dev/null 2>&1 || {
    printf 'runcodex.sh: missing dependency: %s\n' "$dependency" >&2
    exit 127
  }
done

umask 077
runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/runcodex.XXXXXXXX")
runtime_dir=$(cd "$runtime_dir" && pwd -P)
server_pid=
client_pid=

cleanup() {
  local process_id
  trap - EXIT
  trap '' INT TERM HUP
  for process_id in "$client_pid" "$server_pid"; do
    if [[ -n $process_id ]]; then
      kill -TERM "$process_id" 2>/dev/null || true
    fi
  done
  for process_id in "$client_pid" "$server_pid"; do
    if [[ -n $process_id ]]; then
      wait "$process_id" 2>/dev/null || true
    fi
  done
  rm -rf -- "$runtime_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

auth_token=$(od -An -N32 -tx1 /dev/urandom)
auth_token=${auth_token//[[:space:]]/}
printf '%s' "$auth_token" > "$runtime_dir/token"
: > "$runtime_dir/server.log"
export RUNCODEX_CONNECTION_FILE="$runtime_dir/connection.json"

codex app-server --listen ws://127.0.0.1:0 \
  --ws-auth capability-token --ws-token-file "$runtime_dir/token" ${server_arguments[@]+"${server_arguments[@]}"} \
  </dev/null >"$runtime_dir/server.log" 2>&1 &
server_pid=$!

endpoint=
deadline=$((SECONDS + 30))
while true; do
  if ! kill -0 "$server_pid" 2>/dev/null || ((SECONDS >= deadline)); then
    printf 'runcodex.sh: app-server did not become ready.\n' >&2
    cat "$runtime_dir/server.log" >&2
    exit 1
  fi
  if [[ -z $endpoint ]]; then
    while IFS= read -r line; do
      if [[ $line =~ ^[[:space:]]*listening\ on:\ (ws://127\.0\.0\.1:[0-9]+)[[:space:]]*$ ]]; then
        endpoint=${BASH_REMATCH[1]}
        break
      fi
    done < "$runtime_dir/server.log"
  fi
  if [[ -n $endpoint ]] && curl -q --noproxy '*' --silent --fail \
    --max-time 1 "${endpoint/ws:/http:}/readyz" >/dev/null; then
    break
  fi
  sleep 0.05
done

printf '{"version":1,"endpoint":"%s","tokenFile":"token"}\n' "$endpoint" > "$runtime_dir/connection.pending"
mv -- "$runtime_dir/connection.pending" "$RUNCODEX_CONNECTION_FILE"
printf 'runcodex.sh: app-server %s (PID %s)\n' "$endpoint" "$server_pid" >&2
trap ':' INT
RUNCODEX_AUTH_TOKEN=$auth_token codex --remote "$endpoint" \
  --remote-auth-token-env RUNCODEX_AUTH_TOKEN ${cwd_arguments[@]+"${cwd_arguments[@]}"} ${client_arguments[@]+"${client_arguments[@]}"} <&0 &
client_pid=$!

client_status=0
while true; do
  wait "$client_pid" && client_status=0 || client_status=$?
  kill -0 "$client_pid" 2>/dev/null || break
done
exit "$client_status"
