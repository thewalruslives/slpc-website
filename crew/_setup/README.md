# Crew Call — setup

Four steps. The only things Claude can't do for you are the ones that need an
account or a password, which is steps 1 and 3.

---

## 1. Make the Supabase project  (~5 min, yours to do)

1. Go to **supabase.com** and sign up. The free tier covers this easily —
   40 events and a handful of crew is nothing.
2. **New project.** Name it `slpc-crew`. Pick a region near the Bay Area
   (`West US (North California)`). Choose a database password and save it in
   your password manager — you won't need it day to day.
3. Wait for it to finish provisioning.

## 2. Create the tables

In the Supabase dashboard, open **SQL Editor** and run these in order. Paste
the whole file each time, press **Run**.

| File | What it does |
|---|---|
| `01-schema.sql` | Tables, access rules, the crew functions, poster storage |
| `02-data.sql` | Your 40 events, 30 imported answers, and the roster |
| `03-your-turn.sql` | **Edit it first** — the crew code and your admin login |
| `04-staff-needed.sql` | Adds the "staff needed" number to each event |

`03-your-turn.sql` has two lines to change, both marked. It ends with a check
query; you should see `events 40`, `roster 5`, `admins 1`, `crew_code_set 1`.

Before you can run part 2 of that file, create your login:
**Authentication → Users → Add user** → your email and a password you choose.
Claude never sees that password. Then put that same email in the file.

## 3. Connect the site to it

In Supabase: **Project Settings → API**. Copy two values:

- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon public** key — a long string starting `eyJ...`

Paste both into `crew/config.js`, replacing the `PASTE_...` placeholders, then
commit and push. Both are safe to publish — the anon key can only do what the
rules in `01-schema.sql` allow, which is: read nothing, and call the two
passcode-protected crew functions.

**Do not** paste the `service_role` key anywhere. That one bypasses every rule.

## 4. Hand out the links

- Crew: **secondlinepleasure.club/crew/** — they need the crew code, nothing else
- You: **secondlinepleasure.club/crew/admin.html** — email and password

---

## Adding events from a CSV

**Dashboard → Import a CSV.** Built to eat an export of your Master Calendar
without reformatting: it reads that sheet's own headers — `Place`, `Date`,
`City`, `Boil Time`, `Support Hours`, `Music Booking`, `Aaron Note`,
`Confirmed`, `Support A/B/C`, and the three `Nick ...` delivery columns.

- **Times** can be written the way you already write them. `5-8` becomes
  5–8 PM, `12-3` becomes 12–3 PM, `9-6` becomes 9 AM–6 PM. Trailing detail
  like `1-4 (band 12:30-3:30)` keeps the range and moves the rest into notes.
- **Dates** accept `10/3/2026`, `2026-10-03`, or `Oct 3, 2026`.
- **Re-importing is safe.** A row matching an existing venue *and* date
  updates that event rather than adding a second one. Posters and penciled-in
  crew already on the event survive an update.
- **Nothing is written until you look.** The preview lists every row as New or
  Update, flags anything with no support hours, and names any row it had to
  skip and why.
- **`Staff Needed`** sets how many people you want on site. The crew then see
  "1 of 3 signed up · 2 more needed" on the card, and the event stays flagged
  until it's covered. Leave it blank and the app just flags events nobody has
  taken, as before.
- **Crew availability columns are ignored on purpose** — `Rolfe Available`,
  `Marshall Available` and the like. Those answers belong to the crew now, and
  in your sheet a blank and a real "no" both read as FALSE. The preview tells
  you which columns it ignored.

To start from scratch instead, **Download a blank template** gives you the
column headers with two example rows.

## Setting how many staff you need

Each event has a **Staff needed** box in the editor, under the support hours.
Put the number of people you want on site and the crew see their progress
against it — "1 of 3 signed up · 2 more needed" — with the event tagged
**Needs 2 more** until it fills. Once it's covered the tag disappears and the
tally turns green.

Leave it blank on an event you haven't sized yet; that event is only flagged
when nobody at all has said yes. The dashboard's **Crew still needed** tile
adds up the shortfall across every upcoming event.

## The three crew pages

Everything behind the crew code, linked from the bar at the top of each:

- **`/crew/`** — the schedule. Answer events, leave notes, see who else is on.
- **`/crew/me.html`** — one person's own summary: next shift with a countdown,
  how many events they are on, hours booked, what is still waiting on their
  answer, and what they have already worked.
- **`/crew/calendar.html`** — the month at a glance. Each day shows its events
  coloured by state: gold when you are on it, green when the crew is covered,
  rust when it is short, grey for an extra labor day. Tap a day for the detail.
  On a phone the pills become coloured bars so the grid still fits.

## Confirming who actually works

Collecting answers is only half of it — the editor's **Crew** section is where
you say who is on. It lists the roster with each person's answer beside their
name, so you are choosing from what they told you:

    [x] Rolfe      said yes - can deliver
    [ ] Marshall   can't make it
    [x] Bia        said yes
    [ ] Nick       no answer yet

Ticked people get a gold **On the crew** chip on the event card, so they know
they are booked rather than merely willing, and the event lands in their
**My shifts** even if they never pressed a button.

The count follows suit. Before you tick anyone it reads "1 of 3 signed up",
counting volunteers. From the first tick it reads "2 of 3 confirmed" and counts
only the crew you chose — so an event is not covered until you say it is.

Names brought over from the spreadsheet's Support A/B/C columns start out
ticked, including ones carrying a detail like `Bia (10:30-3:30)`; that text is
kept as you saved it.

## How the access rules work

Worth knowing, because it's the part that keeps the schedule private.

**Crew** never touch the tables. The anon key has no read or write permission
on `events`, `responses` or `roster` at all. The crew page calls exactly two
database functions, `crew_load` and `submit_response`, and both check the crew
code first. A wrong code gets a three-quarter-second delay and nothing else,
so guessing is slow and gets logged in `auth_attempts`.

The crew code is stored as a bcrypt hash. Nobody can read it back out —
including you, which is why step 3 tells you to write it down. To change it,
use the dashboard: **Roster & crew code**.

**You** sign in properly through Supabase Auth. Being in the `admins` table is
what grants edit rights; the row-level rules check it on every single query, so
it isn't something a hidden button or a client-side check could get around.

**Posters** are world-readable by design — they're advertising art, and the
crew page needs to show them. Only an admin can upload one.

## If something breaks

- **"Not connected yet" on the page** — `config.js` still has the placeholders.
- **Crew code rejected but you're sure it's right** — re-run part 1 of
  `03-your-turn.sql` with the code you want.
- **You can sign in but see no events** — your user isn't in `admins`. Re-run
  part 2 of `03-your-turn.sql` with the exact email you signed up with.
- **Posters don't appear** — check the `posters` bucket exists and is public
  (Storage → Buckets).
- **A CSV import skips everything** — the header row needs a `Place` column and
  a `Date` column. The preview says which line failed and why.
