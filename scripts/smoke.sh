#!/usr/bin/env bash
set -euo pipefail

curl -fsS http://127.0.0.1:3000/health | jq -e '.ok==true' >/dev/null

curl -fsS 'http://127.0.0.1:3000/api/events/40551?enrich=1' \
| jq -e '.id=="40551" and .date!=null and (.venue|length>0)' >/dev/null

curl -fsS 'http://127.0.0.1:3000/api/events?q=music&limit=5&fuzzy=1&enrich=1' \
| jq -e 'length>=3 and (.[0].date!=null) and (.[0].venue|length>0)' >/dev/null

curl -N -sS 'http://127.0.0.1:3000/ai/chat?message=find%20"The%20National"&limit=1' \
| head -n 5 >/dev/null

echo "OK"
