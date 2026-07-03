#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <port> [port ...]" >&2
  exit 2
fi

for port in "$@"; do
  if ! [[ "$port" =~ ^[0-9]+$ ]]; then
    echo "skip invalid port: $port" >&2
    continue
  fi

  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [ -z "$pids" ]; then
    echo "no listener on localhost tcp:$port"
    continue
  fi

  echo "listeners on tcp:$port"
  for pid in $pids; do
    ps -p "$pid" -o pid= -o command= || true
  done

  for pid in $pids; do
    echo "TERM pid=$pid port=$port"
    kill -TERM "$pid" 2>/dev/null || true
  done

  for _ in 1 2 3 4 5; do
    still_running=""
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        still_running=1
      fi
    done
    [ -z "$still_running" ] && break
    sleep 1
  done

  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "KILL pid=$pid port=$port"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
done
