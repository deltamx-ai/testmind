# TestMind

**Pre-test code reviewer**: compare Jira requirements vs code implementation before you test.

TestMind answers the question: _"Does my code actually implement what the ticket asks for?"_

---

## What it does

Given a Jira ticket and a git branch, TestMind runs a 4-stage AI pipeline and outputs three reports:

| Report | Contents | Use it for |
|--------|----------|------------|
| **A — Requirements** | Per-requirement implementation status (✅ / ⚠️ / ❌) | Developer self-review before handoff |
| **B — Bug Risk** | Ranked potential bugs with trigger conditions | Review before testing |
| **C — Checklist** | Markdown checkboxes for AC + bugs | Paste into PR description |

## Pipeline

```
Jira Ticket ──┐
              ├──► Stage 1: Jira Analysis (LLM)  ──► JiraReport
              │
git diff   ───┤
              ├──► Stage 2: Code Analysis         ──► CodeReport
              │    2a: static (no LLM)
              │    2b: LLM intent extraction
              │
              ├──► Stage 3: Cross-Check (LLM)     ──► CrossCheckReport
              │    requirement × implementation
              │
              └──► Stage 4: Report Gen (no LLM)   ──► 3 Markdown files
```

Each LLM call receives only the structured output of the previous stage — not the raw
diff + raw Jira text all at once. This keeps each call focused and debuggable.

---

## Setup

### Prerequisites

- Node.js ≥ 18
- An Anthropic API key

### Install

```bash
git clone <this-repo>
cd testmind
npm install
npm run build
```

### Environment

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Usage

### Quick start (mock Jira)

Three built-in mock tickets are available: `PROJ-101`, `PROJ-210`, `PROJ-315`

```bash
# Compare HEAD against main on the current repo, using mock Jira
npm run dev -- run \
  --ticket PROJ-101 \
  --base main \
  --head HEAD \
  --repo .
```

Or after building:

```bash
testmind run --ticket PROJ-101 --base main --repo /path/to/your/repo
```

### With real Jira

```bash
testmind run \
  --ticket PROJ-101 \
  --base main \
  --head feature/my-branch \
  --repo /path/to/repo \
  --jira-url https://yourcompany.atlassian.net \
  --jira-token <Personal_Access_Token>
```

### All options

```
testmind run [options]

Required:
  -t, --ticket <key>      Jira ticket key (e.g. PROJ-101)
  -b, --base <branch>     Base branch to diff from (e.g. main)

Optional:
  -H, --head <branch>     Head branch/ref (default: HEAD)
  -r, --repo <path>       Path to git repo root (default: .)
  -o, --output <dir>      Report output directory (default: .testmind/)
  --jira-url <url>        Jira base URL (enables real API mode)
  --jira-token <token>    Jira Personal Access Token
  --config <file>         Path to .testmindrc.json
  --json                  Also write raw structured JSON output
```

---

## Project config (`.testmindrc.json`)

Place in your repo root or pass with `--config`:

```json
{
  "techStack": "React 18 frontend, Node.js 20 backend, PostgreSQL 15",
  "businessRules": [
    "All payment changes must check idempotency",
    "Auth changes must invalidate all sessions",
    "DB schema changes must include a rollback migration"
  ]
}
```

`businessRules` are injected into the Stage 3 prompt so the LLM checks them for every ticket.

---

## Mock Jira tickets

| Key | Type | Description |
|-----|------|-------------|
| `PROJ-101` | Story | Password reset via email — has explicit AC |
| `PROJ-210` | Bug | Cart total wrong with coupon+tax — no AC, terse description |
| `PROJ-315` | Task | Admin audit logging — ambiguous requirements |

These cover the three main scenarios the LLM must handle differently.

---

## Development

```bash
# Run tests (no API key needed — tests are pure/static)
npm test

# Dev mode (watch)
npm run dev -- run --ticket PROJ-101 --base main --repo .

# Build
npm run build
```

---

## Output

Reports are written to `.testmind/` (or your `--output` dir):

```
.testmind/
  PROJ-101-1710000000000-A-requirements.md
  PROJ-101-1710000000000-B-bugs.md
  PROJ-101-1710000000000-C-checklist.md
  PROJ-101-1710000000000-raw.json    (if --json flag used)
```

---

## Adding real Jira support (replacing mock)

The `RealJiraClient` in `src/jira/client.ts` is already implemented.
It uses the Jira REST API v3 with Bearer token auth.

To use it, just pass `--jira-url` and `--jira-token` to the CLI.

**Generating a Jira PAT:**
1. Go to `https://id.atlassian.com/manage-profile/security/api-tokens`
2. Create token → copy value
3. Use as `--jira-token`

---

## Architecture decisions

| Decision | Rationale |
|----------|-----------|
| 3 separate LLM calls (not 1) | Smaller context per call = higher accuracy; easier to debug which stage failed |
| Static analysis before LLM in Stage 2 | Cheap, deterministic, catches smells the LLM might miss |
| No shell: true in git calls | Prevents shell injection; all git args are arrays |
| Inferred AC detection | Many real tickets lack explicit AC; LLM must derive and flag them |
| `unexpectedChanges` field | Catches scope creep and accidental regressions |
