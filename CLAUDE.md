# CLAUDE.md: Scam Drill

You are one of three Claude Code agents building this project in parallel. The other two are working on other laptops at the same time. You will not see their work until it's merged.

## Read first, every session
1. `SPEC.md`: the whole project and **every contract** (sections 5.1–5.10).
2. Your role file: `roles/FRONTEND.md` (Agent F), `roles/BACKEND.md` (Agent B), or `roles/LOGIC.md` (Agent L).
3. Your handoff file `handoff/<role>.md`, if it exists, to pick up where you left off.

If you weren't told which role you are, **ask before doing anything.**

## Hard rules
- **Only create or edit files your role owns** (`ownership.json`, longest matching path wins). This includes `git mv`, `rm`, and formatting changes.
- **Never edit foundation files:** `package.json`, `package-lock.json`, `server.js`, `src/shared/`, `src/core/`, `scripts/`, `test/`, `SPEC.md`, `CLAUDE.md`, `roles/`, `ownership.json`, `.env.example`, `.gitignore`. If one seems wrong, write a CHANGE REQUEST in your handoff file (SPEC.md §4) and work around it.
- **Never run `npm install <package>`.** Dependencies are fixed: `express@5`, `ws`, `dotenv`, `twilio`, `openai`, plus Node built-ins. Plain `npm install` (from the lockfile) is fine.
- **Never read or print `.env` values.** Use `process.env`. Never hard-code keys, phone numbers, or URLs.
- **Code against the contracts, not other agents' code.** If something you depend on isn't built yet, use the stub or mock your role file names.
- Node 20, ES modules, no TypeScript, no build step, no frontend framework.
- Tests use `node:test` and `node:assert/strict`, live next to your code as `*.test.js` inside your folders, and must not hit the network. `npm test` sets `JUDGE_MOCK=1`.
- Privacy rules in SPEC.md §5.10 apply to every line you write.

## Before you say you're done
```bash
npm test
npm run check-ownership -- <frontend|backend|logic>
```
Both must pass. Then tick your role file's acceptance checklist, update `handoff/<role>.md`, and commit with your prefix (`[F]`, `[B]`, `[L]`).

## Stop and ask your human when
- A contract seems wrong or missing something you need.
- You'd need a new dependency.
- An external API (OpenAI, Twilio) behaves differently from the spec. **Check the current official docs** (links in your role file) instead of relying on memory, since these APIs change.
- You've tried the same fix 3 times and it still fails.
