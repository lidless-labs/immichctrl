# Dynamic tool loading benchmark

`prompts.json` is the frozen Runbook Step 1 evaluation set for Immich dynamic
tool loading. The authored candidate labels predate search metadata, domains,
keywords, deferred loading, and measurement code. The set has 32 prompts: 16
single-domain, 8 cross-domain, and 8 safety-sensitive.

Safety prompts provide a `required_tier` and a `gate_probe`. The freeze test
derives the tier from the registered handler with writes disabled, then enabled
without confirmation, and then confirmed when necessary. It does not use
registry metadata.

## Blind adjudication setup

The Step 1 Brigade run is `20260726-192221-21b1a93e`. The sealed adjudication
packet was sent to three isolated, read-only seats: `adjudicator-a`,
`adjudicator-b`, and `adjudicator-c`. The worker protocol did not surface model
identifiers. All three were separate executions of the same Codex worker
configuration, so this is not a cross-model panel.

Every seat received only these two artifacts:

- A catalog of 74 registered tool names and descriptions.
- A prompt list with each prompt ID and text.

The catalog SHA-256 is
`549cead868a95d1ac9ad2e264b97037ed0bdc9ef995b676bc740a12e3726a85f`.
The prompt-only packet SHA-256 is
`dc5e6b1d4edf07b76078cf02ff0ecabf4bc7d20de5a8b3ff497bdde6e331f438`.
The complete packet SHA-256 is
`febcefb8a4a256f74fac5b71fa85b7c8b968a6c7d98a36ef0b04bcbe99f10a00`.
The candidate fixture SHA-256 before adjudication was
`23c65fdd8278ff3a97e0b3f957bb498c2fd83eb0b6a555ebf04829943e6a612d`.

The packet excluded `expected_tools`, `accept_alternatives`, `required_tier`,
`gate_probe`, candidate history, search metadata, and every other seat's
answer. Seats were instructed not to inspect the repository or communicate with
one another. Candidate labels were compared only after every response arrived.

## Adjudication results

Thirty-one prompts were unanimous with their authored candidate labels. This
includes all 16 single-domain prompts, all 8 safety-sensitive prompts, and 7
of 8 cross-domain prompts. No seat failed.

`CD-2` split two to one. `adjudicator-a` and `adjudicator-c` selected the
authored `immich_search_then_album` sequence. `adjudicator-b` selected
`immich_search_smart` followed by `immich_create_album`. The authored label
remains expected and the latter sequence is an accepted alternative.

An earlier read-only review also identified a discrete CD-2 sequence:

```json
[
  "immich_search_metadata",
  "immich_create_album",
  "immich_add_assets_to_album"
]
```

That sequence is also accepted because it completes the same workflow with the
registered tools.

The earlier review selected `immich_memories_today` for `SD-MEMORY-FLOW-1`,
where the candidate is `immich_daily_digest`. Both can answer a request for
today's memories, so `immich_memories_today` is recorded as an accepted
alternative. The candidate label is preserved.

No MiseLedger evidence was available for the earlier review result. The frozen
fixture therefore records the alternative and this caveat rather than claiming
an unsupported vote count.

## Freeze invariant

`tests/benchmark-freeze.test.ts` pins the 16/8/8 split, confirms every expected
tool and accepted alternative is registered, and validates the eight safety
scenarios against executor-enforced gates. It introduces no registry metadata
or search behavior.
