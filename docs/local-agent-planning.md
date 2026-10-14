# Local Agent Planning

**Status:** Design guidance only. This file does not enable or authorize tool execution by itself.

## Goal

Local agents should understand the user's goal, consult project SSOT and relevant context, propose a plan, request the required consent, execute only authorized operations, and verify the real result. They should use the ZombieCoder public API contract and should not need to know which upstream provider/model was selected.

## Agent lifecycle

1. **Classify request:** conversation, question, single task, or multi-task request.
2. **Load bounded context:** project SSOT, syllabus, footprint, recent session messages, and only relevant files. Do not inject entire archives by default.
3. **Set a goal contract:** task, expected real-world result, scope, constraints, permitted tools, and verification method.
4. **Plan and request consent:** obtain approval before risky, destructive, external, or otherwise policy-gated actions.
5. **Check capabilities:** confirm that the selected route has the required verified capabilities (chat, streaming, tools, filesystem, browser, or external network as applicable).
6. **Execute through the runtime:** use explicit tool bindings and server-side authorization; do not infer permission from a model tool call.
7. **Verify:** compare expected vs actual state using direct evidence such as tests, exit codes, file diffs, API responses, or explicit user confirmation where required.
8. **Report honestly:** separate completed, failed, blocked, and not-tested items. Include evidence references and limitations.

## Agent states

- `chat_only`: can converse, explain, and plan, but cannot claim tool execution.
- `tool_capable_locally_tested`: tools passed local contract tests; third-party client/live endpoint behavior may still be unverified.
- `tool_capable_live_verified`: the exact route/client/tool lifecycle has a recent recorded live verification.
- `blocked`: a required capability, permission, credential, TLS condition, or dependency is missing or failed.

Do not infer state from the agent's persona, model name, a green UI indicator, or `/health` alone.

## Tool execution rules

- The model proposes tool calls; the runtime validates tool name, schema, arguments, scope, permission, and task policy.
- Keep filesystem access inside the approved project root; guard against traversal and symlink escapes.
- Do not run arbitrary shell commands merely because a model requests them. Use allowlisted command policy and explicit approval for risky actions.
- Separate read-only inspection from mutation, deletion, network access, package installation, and long-running process control.
- Record `expected`, `actual`, `evidence`, and `status`. `observed` evidence must not silently become `verified` evidence.
- If a provider returns malformed tool calls, preserve the error and use a documented fallback only when safe. Never fabricate tool results.
- If streaming fails after output has been sent, do not silently restart on another model and concatenate responses.
- Never retry a non-idempotent external tool call automatically when it is unclear whether the first attempt took effect.

## Local agent plan files

Keep project-specific SSOT and task plans inside the project (for example, `.zombiecoder/`) and runtime-wide architecture documentation in this repository's `docs/` tree. Do not let an agent rewrite the core constitution or verification policy as a side effect of ordinary project work.

## Required evidence in a completion report

For every meaningful task, report:

- goal and expected outcome;
- files/routes/tools actually touched;
- commands/tests actually run and exit status;
- observed vs verified evidence;
- changes not made and why;
- untested capabilities and environmental limits;
- rollback or diff information when files were changed.

A successful plan is not a successful execution. A successful process exit is not automatically proof of the expected real-world result.
