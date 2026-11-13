# Scam Drill

> Scammers practice on your grandparents every day. We let them practice back.

A fire drill for phone scams. An AI scammer calls a person who opted in, and a referee scores the call live: warnings, strikes, and a red card. When it's over, the scammer's own voice drops the act and explains the trick that almost worked. Then you get a report card, and you can replay your drill as music. Nothing is recorded.

**Humans:** read `SPEC.md`, starting with **§0: How we win** (main track first, then Best Looking Project and Best Inclusion of Music). **Agents:** start at `CLAUDE.md`.

## Quick start (every teammate)
```bash
npm install            # from the lockfile, do not add packages
cp .env.example .env   # fill in your keys (get them privately from the team)
npm test               # 16 foundation tests must pass
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
