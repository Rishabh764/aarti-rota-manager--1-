# Aarti Rota Manager — Ganesh Chaturthi 2026

A single-page tool for whoever runs the society aarti rota. No server, no build step,
no dependencies. Open `index.html` in any browser.

## The society

- 4 towers (A, B, C, D) × 4 floors × 4 flats = **64 flats**
- Festival runs **14–25 September 2026**, 12 days
- **7 host columns per day** as standard, with no hard limit

Baseline rota as supplied:

- **8 flats off the rota** (empty): A-104, A-301, B-201, B-303, B-402, B-403, C-203, D-302
- **2 joint-owner pairs** sharing one slot each: D-401 + D-404, and D-402 + D-403
- **56 flats hosting** across **54 slots** — every one of them exactly once

## Running it

Double-click `index.html`. That is the whole setup.

To put it on a phone or share it with the committee, drop the folder on any static
host (GitHub Pages, Netlify, or a shared drive). Nothing needs installing.

The two fonts load from Google Fonts. Without internet the page falls back to a
system sans and still works.

## What it does

**Move a flat** — pick tower, floor and flat number, then a new date. The flat leaves
its old day and joins the new one. This also puts a removed flat back on the rota.

**Remove a flat** — same picker, takes the flat off the rota entirely.

Both pickers validate as you go. The flat number field takes three digits only and
rejects anything outside the real range: on floor 2 the only valid entries are 201
to 204. Typing a number fills the floor dropdown for you. Once tower and number make
a real flat, a line under the picker tells you where that flat currently sits.

**Joint owners move together.** Touch D-401 and D-404 follows, because one family owns
both. The same applies to D-402 and D-403, and to removals.

**No day gets refused.** Each day shows seven host columns, so there is always room
to move a flat in. Push a day past seven and the table grows an extra column on its
own and the day number turns red, so an unusually heavy day is still obvious.

**Warnings** appear above the tables if a day ends up with nobody hosting, or a flat
is on the rota without a date.

**Contributions** can be typed straight into the flat lookup table. Day totals and the
overall fund update as you type.

**Print rota** prints both tables, schedule first then the full flat list, with the
controls stripped out. **Export CSV** writes both tables into one file that opens
cleanly in Excel.

## Where the data lives

`js/data.js` holds the original rota and never changes — it is the reset point.

Live edits go to **Firestore**, in a document at `rota/current`. Everyone looking at
the site sees the same rota, and changes appear on other screens within a second or
two without anyone refreshing. Local storage is kept as a mirror so the page draws
instantly on load and keeps working with no internet.

The collection and the document are **created automatically** the first time the site
runs. Firestore has no schema to define in advance, so there is nothing to set up in
the console beyond creating the database itself.

The document holds four fields:

| Field | What it holds |
|---|---|
| `schedule` | day number to a list of slots, e.g. `"4": ["A-401", "D-401+D-404", ...]` |
| `vacant` | flats off the rota |
| `donations` | flat number to amount |
| `updatedAt` / `updatedAtMs` | when the last change was made |

A joint-owner slot is stored as `"D-401+D-404"` rather than a nested list, because
Firestore cannot put an array inside an array. The site splits it apart on the way in.
It also reads better in the console.

The pill in the top bar shows the connection: **Live**, **Saving**, **Offline** (edits
queue and sync when the connection returns), or **Local only** (no config, or the
Firebase CDN is unreachable — the tool still works, it just doesn't share).

**Reset** wipes every change, contributions included, restores the original rota, and
pushes that to everyone.

## Firebase setup

Config lives in `js/firebase-config.js`. Those keys are public by design; security
comes from the rules, so the file is safe in a public repo.

1. Firebase console > Firestore Database > Create database. Pick a region near you —
   it cannot be changed later. `asia-south1` is Mumbai.
2. Firestore > Rules > paste the contents of `firestore.rules` > Publish.
3. Open the site. The document appears in the console under `rota` > `current`.

`firestore.rules` ships with the open option active: anyone with the link can edit.
That is fine while the link stays in the committee group. The locked alternative —
everyone reads, only you write — is in the same file, commented out, and needs a
Google sign-in button adding to the page.

### It must be served over http

Firebase uses `type="module"`, and browsers block module imports on `file://`. Once
Firebase is wired in, double-clicking `index.html` no longer connects. Either run

```
cd aarti-site && python3 -m http.server 8000
```

and open `http://localhost:8000`, or put it on GitHub Pages.

If you use Pages or any other host, add that domain under Firebase console >
Authentication > Settings > Authorized domains.

### One caveat

The whole rota is one document, so the last write wins. If two people edit in the same
second, one overwrites the other. With a single manager this never arises, and the
locked rules remove the possibility entirely.

## Changing the baseline

To make a change permanent rather than local, edit `js/data.js`:

- `BASE.vacant` — flats off the rota
- `BASE.pairs` — joint-owner pairs
- `BASE.schedule` — day number to a list of slots, each slot a list of flats
  (two flats in one slot means they host together)
- `FESTIVAL.days` — the dates
- `FESTIVAL.slotColumns` — how many host columns each day shows as standard

Anyone using the tool will need to hit Reset afterwards, or clear local storage, to
pick up the new baseline.

## Files

```
index.html             markup
css/styles.css         styles, including the print layout
js/firebase-config.js  Firebase project keys
js/data.js             the starting rota — the reset point
js/app.js              rendering, validation, edits, export
js/sync.js             Firestore: seeding, live updates, saving
firestore.rules        paste into the Firebase console
```
