#!/usr/bin/env bash
# Gracefully stop anything listening on the local dev port (3000 by default).
#
# vercel dev spawns helper workers (esbuild, the runtime sandbox) that don't
# always exit cleanly when the parent is killed — particularly when the parent
# was started in a backgrounded shell that has since gone away. This script:
#
#   1. Finds every PID with port :PORT bound (TCP listener or established)
#   2. Sends SIGINT — same as Ctrl+C; lets vercel dev run its own cleanup
#   3. Waits up to 5 seconds for them to exit
#   4. Escalates to SIGKILL for anything still alive
#
# Usage:
#   scripts/kill-dev.sh          # default port 3000
#   scripts/kill-dev.sh 4000     # specify a different port
#
# Exit code 0 = port is now free (or was already free). Non-zero = something
# refused both SIGINT and SIGKILL, which would be unusual.

set -u

PORT="${1:-3000}"
WAIT_SECONDS=5

pids_on_port() {
  lsof -ti:"$PORT" 2>/dev/null | sort -u
}

initial="$(pids_on_port)"
if [ -z "$initial" ]; then
  echo "port $PORT is already free"
  exit 0
fi

echo "stopping process(es) on port $PORT:"
ps -o pid=,command= -p $initial 2>/dev/null | sed 's/^/  /'

# Graceful first — SIGINT matches what Ctrl+C in a foreground terminal sends,
# which is what vercel dev's signal handlers are wired for.
echo "$initial" | xargs kill -INT 2>/dev/null || true

# Poll until clear or timeout
for _ in $(seq 1 $WAIT_SECONDS); do
  sleep 1
  remaining="$(pids_on_port)"
  if [ -z "$remaining" ]; then
    echo "port $PORT cleared gracefully"
    exit 0
  fi
done

# Anything still bound after SIGINT + 5s gets SIGKILL. This catches orphaned
# helper workers that didn't respond to their parent's cleanup.
remaining="$(pids_on_port)"
if [ -n "$remaining" ]; then
  echo "force-killing remaining:"
  ps -o pid=,command= -p $remaining 2>/dev/null | sed 's/^/  /'
  echo "$remaining" | xargs kill -KILL 2>/dev/null || true
  sleep 1
fi

final="$(pids_on_port)"
if [ -z "$final" ]; then
  echo "port $PORT cleared"
  exit 0
fi

echo "port $PORT still bound by: $final" >&2
exit 1
