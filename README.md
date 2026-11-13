# Scam Drill

A fire drill for phone scams. An AI scammer calls a person who opted in, a ref scores the call live, and the AI drops the act to teach the tactic that almost worked.

**Humans:** read `SPEC.md`. **Agents:** start at `CLAUDE.md`.

## Quick start (every teammate)
```bash
npm install            # from the lockfile, do not add packages
cp .env.example .env   # fill in your keys (get them privately from the team)
npm test               # 13 foundation tests must pass
npm run dev            # http://localhost:3000
npm run simulate -- test/fixtures/transcript-cra-fail.json
```

## Who does what
| Person | Agent | Branch | Role file |
|---|---|---|---|
| P1 | F | `role/frontend` | `roles/FRONTEND.md` |
| P2 | B | `role/backend` | `roles/BACKEND.md` |
| P3 | L | `role/logic` | `roles/LOGIC.md` |

Start an agent with: `git checkout -b role/<name>`, then `claude`, then paste the launch prompt at the bottom of your role file.

Before every push: `npm test && npm run check-ownership -- <frontend|backend|logic>`.
