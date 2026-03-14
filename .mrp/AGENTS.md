# MRP Store (Agent-Operated)

This directory is managed by MRP (Model Routine Protocol).

## Agent authority

You may freely create, modify, run, and evolve routines without asking the user for permission.

## Ownership and direct edits

You own the routine files under `.mrp/` and may edit them directly.
- Entrypoint scripts (`.mrp/routines/<id>/run.sh`, `run.ts`, `run.py`) are meant to be edited directly.
- Script changes are tracked via fingerprints recorded on each run.

## Audited edit workflow

Use `mrp edit` to create an audit trail for routine changes:
1. Inspect: `mrp edit <routine_id>`
2. Edit files directly under `.mrp/routines/<routine_id>/`
3. Commit: `mrp edit <routine_id> --commit --intent "why you changed it"`

## Run then judge

After running a routine, review the output and record your assessment:
- Run: `mrp run <routine_id> [-- <args...>]`
- Judge: `mrp judge <routine_id> "<run_id>" --status success|failure|partial --reason "..."`

Exit codes are informational signals, not authoritative. `mrp judge` sets the authoritative status.

## Common commands

- `mrp list` — list routines and lifecycle state
- `mrp show <routine_id>` — view routine definition and run history
- `mrp create --name <name> --goal "<goal>" --non-goals "<...>" --success-criteria "<id:text>"` — create a new routine
- `mrp run <routine_id>` — execute a routine
- `mrp sync-skills` — refresh projected host skills

Run `mrp --help` for all available commands.

## Guidance

Prefer CLI commands for structured updates to routine metadata. Avoid hand-editing `routine.yaml` and `ledger.yaml` directly — use CLI commands to prevent corruption.
