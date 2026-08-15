# Hermes Capabilities and Bordercore Applications

Hermes is a general-purpose agent runtime, not only a memory system. It can
execute tools, automate recurring work, browse websites, operate on files,
coordinate subagents, connect to external services, and learn reusable
procedures.

Bordercore currently uses Hermes only as a memory sidecar. Features described
here would require separate, explicitly designed integrations. In particular,
an **Agent Mode** should remain distinct from **Agent Memory** so enabling
memory never changes the model selected in the UI.

## Scheduled monitoring and reports

Hermes includes a scheduler that runs prompts in isolated sessions, records
execution history, and can save or deliver results.

Potential Bordercore jobs include:

- Produce a morning system-health summary.
- Report sustained GPU temperature or VRAM pressure.
- Check Bordercore, Hermes, inference, ASR, and TTS services.
- Generate weekly dependency and security reports.
- Summarize recent commits and unfinished work.
- Monitor disk space, certificates, backups, and failed systemd services.
- Periodically verify the memory save-and-recall path.

A useful initial job would inspect Bordercore's user services, GPU state, disk
space, and recent errors each morning, then save a concise local report.

## Reusable skills and learned workflows

Hermes skills hold procedures that load only when relevant. They complement
factual memory and can preserve successful multi-step workflows.

Potential Bordercore skills include:

- Deploy and verify Bordercore.
- Diagnose a failed model load.
- Benchmark a newly installed model.
- Rotate Hermes credentials safely.
- Test speech recognition and synthesis.
- Review GPU pressure and choose an inference configuration.
- Build and validate the React frontend.
- Prepare a release checklist.

Skills are likely the most valuable Hermes capability after memory because
they can encode verified operational knowledge without permanently placing a
large procedure in the model context.

## Controlled Agent Mode

Bordercore could expose three distinct operating modes:

- **Ordinary mode:** Bordercore operates without Hermes.
- **Agent Memory:** Hermes recalls and stores memory while the UI-selected
  model generates the visible response.
- **Agent Mode:** Hermes owns the turn and may invoke an explicitly restricted
  set of tools.

Agent Mode would suit requests such as:

- Investigate why TTS is unavailable.
- Run the test suite and explain failures.
- Check whether the current frontend build is deployed.
- Inspect GPU utilization and recommend which model to unload.

The interface should display tool activity and require approval for
consequential operations.

## Browser automation

Hermes can operate local or cloud browsers, navigate sites, fill forms, and
extract information.

Potential applications include:

- Verify that the deployed Bordercore interface loads correctly.
- Exercise chat, voice, memory, and model-selection flows.
- Capture screenshots after frontend changes.
- Monitor dashboards that lack an API.
- Collect information from authenticated administrative portals.

Actions that submit forms, publish content, make purchases, or change accounts
should always require explicit approval.

## Terminal and file operations

Hermes can inspect files, apply patches, run commands, and manage processes
through local, containerized, or remote terminal backends.

For Bordercore, this could support:

- Runtime diagnostics on `deepvirtual`.
- Log analysis.
- Test and build execution.
- Configuration validation.
- Model benchmark automation.
- Deployment verification.
- Carefully constrained repair workflows.

Start with read-only diagnostics. Add narrowly scoped write or repair actions
only after approval behavior and auditability are established.

## MCP integrations

Hermes supports Model Context Protocol servers over local stdio and remote
HTTP. Tool filtering can expose only the operations needed from each service.

Useful connections could include:

- GitHub issues and pull requests
- The Bordercore notes API
- Databases
- Home Assistant
- Calendar and email
- Internal infrastructure and monitoring APIs
- Document repositories

One combined workflow could summarize open Bordercore issues, recent commits,
and failed services using separate tools behind a single request.

## Parallel subagents

Hermes can delegate bounded work to child agents with isolated context,
restricted tools, and separate terminal sessions.

Potential applications include:

- Analyze logs while independently checking configuration.
- Benchmark several models concurrently.
- Research multiple implementation approaches.
- Run backend, frontend, and deployment validation in parallel.
- Produce independent diagnoses and compare conclusions.

Delegation is appropriate for complex operational or development work, not
ordinary conversation.

## Session history and search

Hermes records session messages, tool calls, results, model metadata,
timestamps, and searchable history.

Bordercore could use this to:

- Search previous agent investigations.
- Determine when an error last occurred.
- Resume an earlier diagnostic session.
- Inspect past tool actions and outcomes.
- Summarize recent work.
- Audit what an agent changed.

Session search and memory serve different purposes. Search retrieves
historical evidence; memory stores a small collection of curated durable facts.

## Project-aware context

Hermes recognizes project instructions and context files such as `AGENTS.md`,
`.hermes.md`, `CLAUDE.md`, `SOUL.md`, and `.cursorrules`. It can also reference
files, directories, URLs, and Git diffs.

Agent Mode could therefore follow repository-specific rules without copying
those rules into long-term memory.

## Messaging gateway

Hermes supports delivery and interaction through platforms including Discord,
Telegram, Slack, WhatsApp, Signal, Matrix, email, and SMS.

Possible uses include:

- Ask operational questions from a phone.
- Receive service-health alerts.
- Start an approved diagnostic job remotely.
- Receive a morning project brief.
- Get notified when a long benchmark finishes.

## Voice, vision, and image generation

Hermes supports voice interaction, speech transcription, text-to-speech,
vision-capable models, and image generation through supported providers.

Bordercore already has substantial overlap in these areas. Hermes is more
likely to add value as an orchestration layer than as a replacement for
Bordercore's existing voice and visual experience.

## Recommended implementation order

1. **Manage Memory UI** — inspect, correct, and remove memories.
2. **System Health Agent** — read-only inspection of services, GPU, disk, and
   logs.
3. **Scheduled Morning Brief** — run the health workflow automatically.
4. **Bordercore Operations Skill** — encode verified deployment and diagnostic
   procedures.
5. **Explicit Agent Mode** — show tool activity and require approvals.
6. **Session Search** — search previous diagnoses and operational work.
7. **MCP integrations** — begin with GitHub and Bordercore notes.

The best small experiment after memory is a read-only **System Health** action.
Hermes would inspect `deepvirtual`, synthesize the results, and return a compact
report without permission to modify anything.

## Security principles

- Keep Agent Mode separate from Agent Memory.
- Expose the minimum toolset required for each workflow.
- Begin with read-only operations.
- Require approval for file changes, process control, external messages,
  account changes, and other consequential actions.
- Keep secrets server-side and filter environments passed to integrations.
- Record tool activity and outcomes for later inspection.
- Treat browser content, tool output, and retrieved documents as untrusted
  data.

## References

- [Hermes feature overview](https://hermes-agent.nousresearch.com/docs/user-guide/features/overview/)
- [Hermes tools and toolsets](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/)
- [Hermes scheduled tasks](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/)
- [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)
- [Hermes MCP integration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/)
- [Hermes messaging gateway](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/)
- [Hermes sessions](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/sessions.md)
