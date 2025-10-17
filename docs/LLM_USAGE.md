# LLM usage (Ollama)

- Backend in this setup: **ollama:llama3.1** (driven by `OLLAMA_URL` + `LLM_MODEL` in `server/.env`).
- The LLM is used **only** by `/ai/chat` and `/ai/ask` to turn event hits into a natural sentence.
- Event data is fetched by `/api/events` (deterministic, no LLM), so results stay grounded.

## Quick proofs

# Raw hits (no LLM)
curl -sS 'http://127.0.0.1:3000/api/events?limit=8&fuzzy=1&enrich=1' \
| jq '.[0:8] | map({title,date,venue})'

# Hits + LLM text (stream). First "HITS" shows the list the LLM sees,
# then "TEXT" shows the sentence it writes.
curl -N -sS 'http://127.0.0.1:3000/ai/chat?message=what%27s%20on&limit=8' \
| grep '^data:' | sed 's/^data: //' \
| jq -rc 'if .type=="hits" then "HITS:\t"+(.hits|map(.title)|join(", ")) else "TEXT:\t"+.text end'
