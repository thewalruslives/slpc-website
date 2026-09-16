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

## Optional: reading posters automatically

Without this, "Add from screenshot" still saves the poster to the event — you
just type the venue, date and times yourself. With it, Claude reads them off
the flyer and fills the form for you to check.

It needs an **Anthropic API key**, which is billed separately from any Claude
subscription. Reading one poster is a fraction of a cent.

1. Get a key at **console.anthropic.com** → API Keys.
2. Install the Supabase CLI, then from this folder:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
supabase functions deploy extract-poster
```

The function checks that the caller is signed in **and** in the `admins` table
before it spends anything, so a stranger can't run up your bill.

To use a cheaper model, change the `MODEL` line at the top of
`extract-poster/index.ts` to `claude-sonnet-5` or `claude-haiku-4-5`.

---

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
