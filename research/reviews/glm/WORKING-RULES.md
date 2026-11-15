# Working rules (read before the brief)
Your conversation memory is limited and cannot be compacted on this connection: if you fill it, the run
dies and unsaved work is lost. So:
- NEVER print a whole large file. Do not `cat` research/astra/FACT-REVIEW.md, factsheet.md, history.sql,
  any JSON under data/, or the work-*.tsv files. Use `grep -n`, `sed -n 'a,bp'`, `head`, `jq`/python
  one-liners and SQL queries with LIMIT that return at most ~40 short lines at a time.
- To see whether Astra already covered an entity: `grep -n -i "<entity id or name>" research/astra/FACT-REVIEW.md | head`.
- Work entity by entity. After each entity, append any finding immediately to the findings file named in
  your task (one JSON object per line, JSON Lines) using a shell append, then move on. Do not hold
  findings in memory for a final write.
- Keep web fetches small: `curl -sL --max-time 25 <url> | python3 -c "..."` to extract only the relevant
  sentences (strip HTML, grep for keywords, print at most ~30 lines).
- Stay inside the slice named in your task. When the slice is done, write a short section file and stop.
