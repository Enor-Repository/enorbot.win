# Liqd Rollout Scripts

One-shot rollout commands with hard gates for Liqd activation.

## Commands

- `scripts/liqd/phase0.sh`
- `scripts/liqd/phase1.sh`
- `scripts/liqd/phase2.sh`
- `scripts/liqd/phase3.sh`
- `scripts/liqd/phase4.sh`
- `scripts/liqd/phase5.sh [--watch] [--watch-minutes=N]`
- `scripts/liqd/run.sh --phase <0|1|2|3|4|5>`
- `scripts/liqd/run.sh --all`
- `scripts/liqd/run.sh --all --activate --watch --watch-minutes 60`

## Phase intent

- `phase0`: Freeze + baseline safety (pause non-Liqd, control-group trigger lockdown, Liqd roles)
- `phase1`: Hardening quality gate (build, tests, required hardening checks)
- `phase2`: Liqd trigger profile hardening (safe `deal_volume` regex, control `deal_volume` off)
- `phase3`: Certification checks (parser scenarios + transcript safety checks)
- `phase4`: Production preflight (all hard gates before activation)
- `phase5`: Activate Liqd + optional watchdog auto-guard

## Required env

- `SUPABASE_URL`
- `SUPABASE_KEY`

Optional overrides:

- `LIQD_GROUP_JID`
- `CONTROL_GROUP_JID`
- `LIQD_TEST_GROUP_JID`
- `LIQD_OPERATOR_JID`
- `LIQD_IGNORED_JID`
- `LIQD_SAFE_VOLUME_REGEX`
- `LIQD_ROLLOUT_ACTOR`
- `LIQD_ROLLOUT_STATE_FILE`

## State file

By default the runner writes phase completion state to:

- `.liqd-rollout-state.json`

Use `LIQD_ROLLOUT_STATE_FILE` to override.

