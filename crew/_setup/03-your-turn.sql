-- Second Line Crew Call — the two personal bits.
--
-- DO NOT type your real crew code into this file. It is a public repository.
-- Paste this file into the Supabase SQL Editor FIRST, then edit the two marked
-- values in that editor window and run it there. Nothing personal ever lands
-- on disk that way.
-- Run it AFTER 01-schema.sql and 02-data.sql.

-- pgcrypto lives in the extensions schema on Supabase; this lets crypt() be found.
set search_path = public, extensions;

-- ── 1. Set the crew code ────────────────────────────────────────────────
-- Replace CHANGE-ME with the code you'll give Rolfe, Marshall, Bia and Nick.
-- It is stored as a bcrypt hash, so nobody can read it back out of the
-- database — including you. Write it down somewhere.

insert into app_config (key, value)
values ('crew_passcode', crypt('CHANGE-ME', gen_salt('bf')))
on conflict (key) do update set value = excluded.value;


-- ── 2. Make yourself an admin ───────────────────────────────────────────
-- First create your login: Supabase dashboard → Authentication → Users →
-- "Add user" → your email and a password you choose. Claude never sees it.
-- Then replace the email below with that same address and run this.

insert into admins (user_id, email)
select id, email from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;


-- ── check it worked ─────────────────────────────────────────────────────
select (select count(*) from events)    as events,
       (select count(*) from responses) as responses,
       (select count(*) from roster)    as roster,
       (select count(*) from admins)    as admins,
       (select count(*) from app_config where key = 'crew_passcode') as crew_code_set;
