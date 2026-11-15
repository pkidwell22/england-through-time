#!/bin/bash
# Runs the GLM review as four independent, small sessions so no single run exhausts its context.
cd "$(dirname "$0")/../../.."
run() { # slice-name, task text
  codex exec -C "$PWD" --skip-git-repo-check -s workspace-write -m "glm-5.3:cloud" -c 'model_reasoning_effort="high"' \
    -o "research/reviews/glm/LAST-MESSAGE-$1.md" \
    "First read research/reviews/glm/WORKING-RULES.md and obey it strictly. Then read research/reviews/glm/BRIEF.md for the method, standards and output fields. Your slice for THIS run is ONLY: $2 Append each finding as one JSON object per line to research/reviews/glm/findings-$1.jsonl (same fields as the brief's findings.json objects) as soon as you have it. When the slice is finished, write research/reviews/glm/REVIEW-$1.md (counts, each S1/S2 finding with app claim, problem, evidence links and exact proposed correction, disagreements with Astra, what you could not check). Work autonomously; do not ask questions; write only under research/reviews/glm/." \
    < /dev/null > "research/reviews/glm/run-$1.log" 2>&1
  echo "$1 exit $?" >> research/reviews/glm/chunks-status.txt
}
run places-england "places in data/national/places.json that are NOT battles (kind != battle): dates, period names (altNames) and their ranges, size ranks, coordinates. Prioritise places that reach size 4 or 5 and all Roman-period and prehistoric entries; then sample the rest."
run places-wales "every place in data/national/places-wales.json that is not a battle, and every polity in data/national/polities-wales.json: dates, period and Welsh names, sizes, extents, notes."
run polities-lines "every polity in data/national/polities.json and every line feature in data/national/lines.json (Roman roads, Hadrian's Wall, dykes, the Ridgeway, the Great North Road, the 1536 border), plus data/national/eras.json, events.json and the woodland and sea-level keyframes and notes in data/national/site.json and terrain.json."
run stonehenge "the Stonehenge site, data/locations/stonehenge/*.json: the stage chronology, each landmark's phases and dates, the stone settings, surrounding monuments (Cursus, Avenue, Durrington Walls, Woodhenge, barrows), eras, events and episodes."
echo "all done" >> research/reviews/glm/chunks-status.txt
