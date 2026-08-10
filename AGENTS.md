# AGENTS.md

The conventions for this repository live in **[CLAUDE.md](./CLAUDE.md)**. Read
that file.

This file exists because some tools look for `AGENTS.md` by name. It is a
pointer, not a copy.

It *was* a copy — a byte-identical 101KB duplicate of `CLAUDE.md`, created so
both filenames resolved. Two copies of a document that is edited on almost every
change is a guarantee that one of them goes stale, and the stale one is
whichever the next tool happens to read. The same reasoning is why
`components/shell/footer.tsx` is a re-export rather than a second footer, and
why `lib/brand.ts` exists at all.

## Where to start

| You are about to…                    | Read                                                        |
| ------------------------------------ | ----------------------------------------------------------- |
| Add a backend module                 | [CLAUDE.md](./CLAUDE.md) — "Layering" and "Module shape"     |
| Touch anything on the money path     | [CLAUDE.md](./CLAUDE.md) — Ticketing / Booking / Payments    |
| Work on the frontend                 | [frontend/README.md](./frontend/README.md)                   |
| Pick up the next piece of work       | [PENDING_TASKS.md](./PENDING_TASKS.md)                       |
| Understand a deliberate omission     | [frontend/BACKLOG.md](./frontend/BACKLOG.md)                 |
| Deploy                               | [DEPLOYMENT.md](./DEPLOYMENT.md)                             |
