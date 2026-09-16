-- Adds "how many staff do I need" to each event.
-- Run this once in the Supabase SQL Editor. Safe to re-run.

alter table events
  add column if not exists staff_needed int not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_staff_needed_check') then
    alter table events add constraint events_staff_needed_check
      check (staff_needed >= 0 and staff_needed <= 99);
  end if;
end $$;

-- 0 means "not set", and the app falls back to flagging any event with nobody
-- on it. Set a real number per event in the dashboard, or in bulk from a CSV
-- column called "Staff Needed".

select count(*) as events, count(*) filter (where staff_needed > 0) as with_a_target
from events;
