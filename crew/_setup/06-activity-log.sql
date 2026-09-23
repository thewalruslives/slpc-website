-- Second Line Crew Call — activity log.
-- Records every change to events, crew answers and the roster: who, when, and
-- exactly what moved. Run once in the Supabase SQL Editor. Safe to re-run.
--
-- The log is written by database triggers, not by the app, so a change made
-- from the dashboard, a CSV import, the crew page or straight from the SQL
-- editor is recorded the same way.

create table if not exists audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  actor_kind text not null,                 -- crew | admin | system
  action     text not null,                 -- created | updated | deleted | answered
  entity     text not null,                 -- event | answer | roster | crew code
  entity_id  text,
  summary    text not null,
  details    jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);

alter table audit_log enable row level security;
drop policy if exists admin_read_audit on audit_log;
create policy admin_read_audit on audit_log for select to authenticated using (is_admin());

-- ── who is making this change ────────────────────────────────────────────
-- Crew writes come through submit_response, which stamps the name below.
-- Admin writes carry a signed-in JWT. Anything else is the database itself.

create or replace function current_actor() returns text
  language plpgsql stable security definer set search_path = public, auth as $$
declare a text;
begin
  a := nullif(current_setting('app.actor', true), '');
  if a is not null then return a; end if;
  begin a := nullif(auth.jwt() ->> 'email', ''); exception when others then a := null; end;
  return coalesce(a, 'system');
end $$;

create or replace function current_actor_kind() returns text
  language plpgsql stable security definer set search_path = public, auth as $$
declare k text;
begin
  k := nullif(current_setting('app.actor_kind', true), '');
  if k is not null then return k; end if;
  if current_actor() <> 'system' then return 'admin'; end if;
  return 'system';
end $$;

-- ── readable values ──────────────────────────────────────────────────────

create or replace function pretty(v jsonb) returns text
  language sql immutable as $$
  select case
    when v is null or v = 'null'::jsonb then '(empty)'
    when jsonb_typeof(v) = 'string' then case when v #>> '{}' = '' then '(empty)' else v #>> '{}' end
    when jsonb_typeof(v) = 'boolean' then case when v::text = 'true' then 'yes' else 'no' end
    when jsonb_typeof(v) = 'array'  then case when jsonb_array_length(v) = 0 then '(nobody)'
      else (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(v) x) end
    else v::text end $$;

create or replace function field_label(k text) returns text
  language sql immutable as $$
  select case k
    when 'place' then 'venue'            when 'city' then 'city'
    when 'date' then 'date'              when 'event_start' then 'boil start'
    when 'event_end' then 'boil end'     when 'support_start' then 'support start'
    when 'support_end' then 'support end' when 'staff_needed' then 'staff needed'
    when 'assigned_staff' then 'crew'    when 'confirmed' then 'confirmed'
    when 'band' then 'band'              when 'sold_estimate' then 'sold estimate'
    when 'notes' then 'notes'            when 'aaron_note' then 'note'
    when 'nick_work' then 'delivery note'
    when 'nick_dropoff_dublin' then 'Dublin drop-off'
    when 'nick_direct_to_location' then 'craw to site'
    when 'nick_needs_ride' then 'needs a ride'
    when 'poster_path' then 'poster'     when 'kind' then 'type'
    when 'can_deliver' then 'can deliver' when 'status' then 'answer'
    when 'note' then 'note'              when 'active' then 'active'
    else replace(k, '_', ' ') end $$;

-- ── events ───────────────────────────────────────────────────────────────

create or replace function log_event_change() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; k text; parts text[] := '{}'; d jsonb := '{}'::jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into audit_log(actor, actor_kind, action, entity, entity_id, summary, details)
    values (current_actor(), current_actor_kind(), 'created', 'event', NEW.id,
            'Added ' || NEW.place || ' on ' || to_char(NEW.date, 'FMMon FMDD'), to_jsonb(NEW));
    return NEW;
  elsif TG_OP = 'DELETE' then
    insert into audit_log(actor, actor_kind, action, entity, entity_id, summary, details)
    values (current_actor(), current_actor_kind(), 'deleted', 'event', OLD.id,
            'Deleted ' || OLD.place || ' on ' || to_char(OLD.date, 'FMMon FMDD'), to_jsonb(OLD));
    return OLD;
  end if;

  o := to_jsonb(OLD) - 'updated_at' - 'source';
  n := to_jsonb(NEW) - 'updated_at' - 'source';
  for k in select jsonb_object_keys(n) loop
    if (o -> k) is distinct from (n -> k) then
      parts := parts || (field_label(k) || ' ' || pretty(o -> k) || ' → ' || pretty(n -> k));
      d := d || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', n -> k));
    end if;
  end loop;
  if cardinality(parts) = 0 then return NEW; end if;   -- a save that changed nothing

  insert into audit_log(actor, actor_kind, action, entity, entity_id, summary, details)
  values (current_actor(), current_actor_kind(), 'updated', 'event', NEW.id,
          NEW.place || ' on ' || to_char(NEW.date, 'FMMon FMDD') || ' — ' ||
            array_to_string(parts, '; '),
          d);
  return NEW;
end $$;

drop trigger if exists trg_log_events on events;
create trigger trg_log_events after insert or update or delete on events
  for each row execute function log_event_change();

-- ── crew answers ─────────────────────────────────────────────────────────

create or replace function log_response_change() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  r record; who text; what text; extra text := '';
begin
  if TG_OP = 'DELETE' then
    select place, date into r from events where id = OLD.event_id;
    insert into audit_log(actor, actor_kind, action, entity, entity_id, summary, details)
    values (current_actor(), current_actor_kind(), 'deleted', 'answer', OLD.event_id,
            OLD.staff || '’s answer removed for ' || coalesce(r.place, OLD.event_id), to_jsonb(OLD));
    return OLD;
  end if;

  select place, date into r from events where id = NEW.event_id;
  who := NEW.staff;
  what := case NEW.status
            when 'yes'   then 'can work'
            when 'no'    then 'can’t make'
            when 'maybe' then 'might make'
            else 'cleared their answer for' end;

  if TG_OP = 'UPDATE' then
    if OLD.status is not distinct from NEW.status
       and OLD.can_deliver is not distinct from NEW.can_deliver
       and OLD.note is not distinct from NEW.note then
      return NEW;
    end if;
    if OLD.can_deliver is distinct from NEW.can_deliver then
      extra := extra || case when NEW.can_deliver then '; offered to deliver'
                             else '; withdrew the delivery offer' end;
    end if;
    if OLD.note is distinct from NEW.note then
      extra := extra || case when coalesce(NEW.note,'') = '' then '; removed their note'
                             else '; note: ' || NEW.note end;
    end if;
  elsif NEW.can_deliver then
    extra := '; offered to deliver';
  end if;

  insert into audit_log(actor, actor_kind, action, entity, entity_id, summary, details)
  values (who, 'crew', 'answered', 'answer', NEW.event_id,
          who || ' ' || what || ' ' || coalesce(r.place, NEW.event_id) ||
            coalesce(' on ' || to_char(r.date, 'FMMon FMDD'), '') || extra,
          jsonb_build_object('status', NEW.status, 'can_deliver', NEW.can_deliver, 'note', NEW.note));
  return NEW;
end $$;

drop trigger if exists trg_log_responses on responses;
create trigger trg_log_responses after insert or update or delete on responses
  for each row execute function log_response_change();

-- ── roster ───────────────────────────────────────────────────────────────

create or replace function log_roster_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into audit_log(actor, actor_kind, action, entity, entity_id, summary, details)
    values (current_actor(), current_actor_kind(), 'created', 'roster', NEW.name,
            'Added ' || NEW.name || ' to the roster', to_jsonb(NEW));
  elsif TG_OP = 'DELETE' then
    insert into audit_log(actor, actor_kind, action, entity, entity_id, summary, details)
    values (current_actor(), current_actor_kind(), 'deleted', 'roster', OLD.name,
            'Removed ' || OLD.name || ' from the roster', to_jsonb(OLD));
  elsif OLD.active is distinct from NEW.active then
    insert into audit_log(actor, actor_kind, action, entity, entity_id, summary, details)
    values (current_actor(), current_actor_kind(), 'updated', 'roster', NEW.name,
            NEW.name || case when NEW.active then ' put back on the roster'
                             else ' taken off the roster' end,
            jsonb_build_object('active', NEW.active));
  end if;
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_log_roster on roster;
create trigger trg_log_roster after insert or update or delete on roster
  for each row execute function log_roster_change();

-- ── stamp the crew member's name onto their own writes ───────────────────
-- submit_response runs as the database owner, so without this the log would
-- credit every crew answer to "system".

create or replace function submit_response(
  p_passcode text, p_event_id text, p_staff text,
  p_status text, p_can_deliver boolean, p_note text
) returns void
  language plpgsql security definer set search_path = public, extensions as $$
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

  perform set_config('app.actor', p_staff, true);
  perform set_config('app.actor_kind', 'crew', true);

  insert into responses (event_id, staff, status, can_deliver, note, updated_at)
  values (p_event_id, p_staff, coalesce(p_status,''), coalesce(p_can_deliver,false),
          left(coalesce(p_note,''), 500), now())
  on conflict (event_id, staff) do update
    set status      = excluded.status,
        can_deliver = excluded.can_deliver,
        note        = excluded.note,
        updated_at  = now();
end $$;

revoke all on function submit_response(text,text,text,text,boolean,text) from public, anon, authenticated;
grant execute on function submit_response(text,text,text,text,boolean,text) to anon, authenticated;

-- ── the crew code, which has no table of its own to watch ────────────────

create or replace function set_crew_passcode(p_new text) returns void
  language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if length(coalesce(p_new,'')) < 6 then raise exception 'Use at least 6 characters'; end if;
  insert into app_config (key, value) values ('crew_passcode', crypt(p_new, gen_salt('bf')))
    on conflict (key) do update set value = excluded.value;
  insert into audit_log(actor, actor_kind, action, entity, entity_id, summary)
  values (current_actor(), 'admin', 'updated', 'crew code', null,
          'Changed the crew code');
end $$;

revoke all on function set_crew_passcode(text) from public, anon, authenticated;
grant execute on function set_crew_passcode(text) to authenticated;

select count(*) as entries_so_far from audit_log;
