# Pharmaceutical process development — research-reuse pilot

**Complete:** *Making the Same Drug a Different Way*, a fresh 15-minute-profile text run using the saved research and previously verified corrections. Final script: **2,119 words, 21 turns**, whole-episode review **acceptable**. Approximate duration is 14.6 minutes at 145 words per minute; a slower 120–135 pace would take 15.7–17.7 minutes. No audio was generated.

[Read the transcript](transcript.md) · [Editorial and execution assessment](assessment.md) · [Measurements](pilot-summary.json) · [Exact review and dialogue](transcript.json)

The new run's conservative allowance is **$1.69399**. Together with the first pharmaceutical run, the conservative total is **$3.500258125 of $5**, retaining the earlier abandoned request's full reservation. Actual billed charges are unknown. There were **zero new searches or source reads** and no duplicated generation submissions.

The refreshed cast is Nell Arden, host; Mira Calder, process chemistry; Tomas Venn, biocatalysis; and Leena Orrell, process engineering. The guests have four, four and three turns respectively. Two silent host yields allow a late exchange among guests. Narrative selection, shorter host questions and participation improved; similar explanatory rhythms, a prolonged hypothetical ending and the missing reported activity magnitude remain editorial limitations.

The source commit at preparation was `349f5f541dfd400355ef1fea64d6399c073c656d`. `research-reuse-origin.json` identifies exactly what was reused. `authorization.json`, `research-reuse-transition.json`, `context-limit-recovery.json` and `bucket-rebalance.json` preserve the ceiling and local recovery decisions. The original run and its source artifacts are unchanged.

`prepare-run.ts` records the task-specific reuse setup and refreshed commission. It uses the existing approved credential without storing it. The ordinary production CLI continued from synthesis:

```bash
node --env-file=.env.local --experimental-strip-types scripts/run-text-pilot.ts --run --minutes 15 --topic 'pharmaceutical process development and chemistry' --ceiling 3.19 --out node_modules/.cache/still-curious-pharma-reuse-02
```

The accepted run is now saved here; do not launch a new generation merely to reproduce its report. `finalize-run.ts` reads and verifies the completed runtime state without provider calls, exports the exact approved text and copies the result into this directory. The task-specific script's initial settings and subsequent changes are distinguished in the recovery records. The run is local and does not appear in the production app's Saved list.
