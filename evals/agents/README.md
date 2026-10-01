# Agent prompt smoke suite

These 15 synthetic cases cover conversational transaction edits, explicit resets, ambiguous amounts, correction targets, local number wording, foreign currencies, unsupported balance changes, merchant/category ambiguity, reimbursement evidence, mixed conceptual and personal questions, and incomplete records.

The runner uses Nest's code-default instructions, schemas, capability filters, and configured shared deployment. It replays synthetic tool results by name; it never dispatches workspace tools or writes financial records. Responses are checked before application postprocessing. Assertions cover selected structured fields, tool names and arguments, required or forbidden answer content, and review coverage. They do not measure overall financial-advice quality or replace integration tests.

## Running

Use Node 22. Validate fixtures without contacting the provider:

```sh
npm run ai:eval:agents
```

Save the current composed prompts before changing them, then evaluate that snapshot using server settings from `.env`:

```sh
npm run ai:eval:agents -- --snapshot /tmp/nest-prompts-before.json
node --env-file=.env --import tsx scripts/evaluate-agent-prompts.mjs --live --from /tmp/nest-prompts-before.json --output /tmp/nest-prompts-before-results.json
```

After changing prompts, run the same cases again:

```sh
node --env-file=.env --import tsx scripts/evaluate-agent-prompts.mjs --live --snapshot /tmp/nest-prompts-after.json --output /tmp/nest-prompts-after-results.json
```

Live runs incur provider usage. Two cases run concurrently, each with a 90-second deadline, no automatic retries, and at most four tool rounds/eight tool calls. Reports include outputs, requested tools, checks, timings, token usage, prompt hashes, and a dataset hash. Tool fixtures are selected by name, not arguments; assertions separately inspect relevant arguments. Production grounding repair and financial tool implementations are not exercised by this runner.

If an assertion incorrectly rejects a valid answer, correct it and rescore **both** reports with the same checks without new model calls:

```sh
npm run ai:eval:agents -- --rescore /tmp/nest-prompts-before-results.json --output /tmp/nest-prompts-before-rescored.json
npm run ai:eval:agents -- --rescore /tmp/nest-prompts-after-results.json --output /tmp/nest-prompts-after-rescored.json
```

## Recorded comparison

On 2026-10-01, one run of each version used the same configured deployment, `gpt-6-astra`, and the same corrected checks:

| Configuration | Passed | Total provider tokens |
| --- | ---: | ---: |
| Original prompts and routing | 14 / 15 | 39,872 |
| Prompt version `2026-10-01.3` and revised routing | 15 / 15 | 62,157 |

Dataset SHA-256: `7870a9747951fdca93336d19b6613e3cf7371084133f679f3b5387bb36edb1f0`.

The concrete failure fixed was “What does today's money mean, and what is my retirement target in today's money?” The original conceptual routing disabled tools, so the model answered only the definition and reported that it could not retrieve the target. The revised request called the retirement projection tool and answered both parts using the synthetic result.

The original report initially rejected two otherwise correct answers because of overly narrow wording checks. Those checks were corrected and the original outputs rescored; the comparison above uses the corrected checks throughout. This is a small, single-run smoke comparison with variable model outputs, not a general capability benchmark. The richer prompts and additional successful lookup also increased token usage. No model weights were trained or changed.
