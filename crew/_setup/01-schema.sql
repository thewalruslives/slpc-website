-- Second Line Crew Call — database setup
-- Paste this whole file into the Supabase SQL Editor and press Run.
-- Safe to re-run: it drops and recreates policies and functions.

-- Supabase keeps extensions in their own schema, so every function that calls
-- crypt()/gen_salt() below sets search_path to "public, extensions".
create extension if not exists pgcrypto;

-- ─────────────────────────────── tables ───────────────────────────────

create table if not exists roster (
  name        text primary key,
  sort_order  int  not null default 0,
  active      boolean not null default true
);

create table if not exists events (
  id            text primary key,
  place         text not null,
  city          text not null default '',
  date          date not null,
  event_start   time, event_end   time,      -- the boil
  support_start time, support_end time,      -- when crew is needed
  band          text not null default '',
  sold_estimate text not null default '',
  notes         text not null default '',
  aaron_note    text not null default '',
  nick_work     text not null default '',
  confirmed     boolean not null default false,
  nick_dropoff_dublin     boolean not null default false,
  nick_direct_to_location boolean not null default false,
  nick_needs_ride         boolean not null default false,
  assigned_staff text[] not null default '{}',
  kind          text not null default 'event' check (kind in ('event','labor')),
  poster_path   text,
  source        text not null default '',
  updated_at    timestamptz not null default now()
);
create index if not exists events_date_idx on events (date);

create table if not exists responses (
  event_id    text not null references events(id) on delete cascade,
  staff       text not null,
  status      text not null default ''  check (status in ('yes','no','maybe','')),
  can_deliver boolean not null default false,
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (event_id, staff)
);

-- The crew passcode lives here as a bcrypt hash. No API role can read this
-- table: it has RLS on and deliberately no policies. Only the SECURITY
-- DEFINER functions below can see it.
create table if not exists app_config (
  key   text primary key,
  value text not null
);

-- Who may edit the schedule. A row here is what makes a signed-in user an admin.
create table if not exists admins (
  user_id uuid primary key,
  email   text,
  added_at timestamptz not null default now()
);

-- Failed passcode attempts, so brute force is visible and throttled.
create table if not exists auth_attempts (
  id serial primary key,
  at timestamptz not null default now()
);

-- ──────────────────────────── row level security ────────────────────────────
-- Everything is locked by default. Crew reach the data only through the two
-- functions further down; admins reach it through these policies.

alter table roster        enable row level security;
alter table events        enable row level security;
alter table responses     enable row level security;
alter table app_config    enable row level security;  -- no policies, ever
alter table admins        enable row level security;
alter table auth_attempts enable row level security;  -- no policies, ever

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from admins where user_id = auth.uid()) $$;

drop policy if exists admin_all_events    on events;
drop policy if exists admin_all_responses on responses;
drop policy if exists admin_all_roster    on roster;
drop policy if exists admin_read_admins   on admins;

create policy admin_all_events    on events    for all to authenticated
  using (is_admin()) with check (is_admin());
create policy admin_all_responses on responses for all to authenticated
  using (is_admin()) with check (is_admin());
create policy admin_all_roster    on roster    for all to authenticated
  using (is_admin()) with check (is_admin());
create policy admin_read_admins   on admins    for select to authenticated
  using (user_id = auth.uid());

-- ──────────────────────── crew access (passcode only) ────────────────────────

create or replace function check_passcode(p_passcode text) returns boolean
  language plpgsql stable security definer set search_path = public, extensions as $$
declare stored text;
begin
  select value into stored from app_config where key = 'crew_passcode';
  if stored is null or p_passcode is null then return false; end if;
  return stored = crypt(p_passcode, stored);
end $$;

-- Everything the crew page needs, in one call. Returns null if the passcode
-- is wrong, after a short delay so guessing is slow.
create or replace function crew_load(p_passcode text) returns json
  language plpgsql stable security definer set search_path = public as $$
begin
  if not check_passcode(p_passcode) then
    perform pg_sleep(0.75);
    return null;
  end if;
  return json_build_object(
    'roster', (select coalesce(json_agg(r.name order by r.sort_order, r.name), '[]'::json)
               from roster r where r.active),
    'events', (select coalesce(json_agg(to_jsonb(e) order by e.date), '[]'::json) from events e),
    'responses', (select coalesce(json_agg(to_jsonb(x)), '[]'::json) from responses x)
  );
end $$;

-- The only way the crew can write. Validates the passcode, the person and the
-- answer before it touches the table.
create or replace function submit_response(
  p_passcode text, p_event_id text, p_staff text,
  p_status text, p_can_deliver boolean, p_note text
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not check_passcode(p_passcode) then
    perform pg_sleep(0.75);
    insert into auth_attempts default values;
    raise exception 'Wrong crew code' using errcode = '28000';
  end if;
  if coalesce(p_status,'') not in ('yes','no','maybe','') then
    raise exception 'Not a valid answer';
  end if;
  if not exists (select 1 from roster where name = p_staff and active) then
    raise exception 'Not a name on the roster';
  end if;
  if not exists (select 1 from events where id = p_event_id) then
    raise exception 'No such event';
  end if;

  insert into responses (event_id, staff, status, can_deliver, note, updated_at)
  values (p_event_id, p_staff, coalesce(p_status,''), coalesce(p_can_deliver,false),
          left(coalesce(p_note,''), 500), now())
  on conflict (event_id, staff) do update
    set status      = excluded.status,
        can_deliver = excluded.can_deliver,
        note        = excluded.note,
        updated_at  = now();
end $$;

-- anon may call these two functions and nothing else.
revoke all on function crew_load(text)                                from public, anon, authenticated;
revoke all on function submit_response(text,text,text,text,boolean,text) from public, anon, authenticated;
revoke all on function check_passcode(text)                           from public, anon, authenticated;
grant execute on function crew_load(text)                                to anon, authenticated;
grant execute on function submit_response(text,text,text,text,boolean,text) to anon, authenticated;

-- ─────────────────── admin-only: change the crew code ───────────────────

create or replace function set_crew_passcode(p_new text) returns void
  language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if length(coalesce(p_new,'')) < 6 then raise exception 'Use at least 6 characters'; end if;
  insert into app_config (key, value) values ('crew_passcode', crypt(p_new, gen_salt('bf')))
    on conflict (key) do update set value = excluded.value;
end $$;

revoke all on function set_crew_passcode(text) from public, anon, authenticated;
grant execute on function set_crew_passcode(text) to authenticated;

-- ───────────────────────── poster storage ─────────────────────────
-- Posters are readable by anyone with the link (they are advertising art);
-- only an admin can put one there.

insert into storage.buckets (id, name, public)
values ('posters', 'posters', true)
on conflict (id) do nothing;

drop policy if exists posters_read  on storage.objects;
drop policy if exists posters_write on storage.objects;

create policy posters_read on storage.objects for select to public
  using (bucket_id = 'posters');
create policy posters_write on storage.objects for all to authenticated
  using      (bucket_id = 'posters' and is_admin())
  with check (bucket_id = 'posters' and is_admin());
