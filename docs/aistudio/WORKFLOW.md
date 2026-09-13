# AI Studio Development Workflow

This project is developed primarily through natural-language conversation in Google AI Studio by a non-programmer domain expert.

## Branch roles

- `main`: stable branch and last known good version.
- `aistudio-dev`: normal AI Studio development branch.
- `aistudio-import-baseline-2026-09-13`: recovery baseline created after AI Studio import stability was restored.

## Daily workflow

1. Keep one long-lived AI Studio project connected to `aistudio-dev`.
2. Describe requested behavior in ordinary language. The user does not need to name files or functions.
3. Before a large or sensitive change, create an AI Studio checkpoint.
4. After each change, ask AI Studio to review only the requested scope, run TypeScript/build validation, and summarize the result in simple language.
5. If the result is wrong, prefer Restore to the last good checkpoint instead of stacking more repairs on top of a broken state.
6. Do not routinely re-import the GitHub repository. Re-import only for recovery or deliberate migration testing.

## Agent instruction files

Do not reintroduce large duplicated root-level agent instruction files without a controlled A/B test. The previous instruction-file setup caused AI Studio GitHub import / agent initialization failures.

For now, keep AI Studio working from normal project files and task-specific conversation context.

## Promotion flow

Use this path:

`AI Studio -> aistudio-dev -> validation/review -> main`

Do not treat every AI Studio edit as production-ready. `main` should receive only changes that have been reviewed and validated.

## Recovery order

If something breaks, recover in this order:

1. AI Studio checkpoint Restore.
2. Last known good commit on `aistudio-dev`.
3. `main`.
4. `aistudio-import-baseline-2026-09-13` for a clean import baseline.

The non-programmer user should normally only need the first step.