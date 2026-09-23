-- Copy the 23 Sep extra labor day onto 25 Sep, and set the location on both.
-- Paste into the Supabase SQL Editor and Run. Safe to re-run.

-- Everything about the job comes across. Who is confirmed for each day is
-- deliberately left alone — that is a per-day decision.
update events as tgt set
  place                   = src.place,
  event_start             = src.event_start,
  event_end               = src.event_end,
  support_start           = src.support_start,
  support_end             = src.support_end,
  staff_needed            = src.staff_needed,
  band                    = src.band,
  sold_estimate           = src.sold_estimate,
  notes                   = src.notes,
  aaron_note              = src.aaron_note,
  nick_work               = src.nick_work,
  confirmed               = src.confirmed,
  nick_dropoff_dublin     = src.nick_dropoff_dublin,
  nick_direct_to_location = src.nick_direct_to_location,
  nick_needs_ride         = src.nick_needs_ride,
  kind                    = src.kind,
  updated_at              = now()
from events as src
where src.id = '2026-09-23-extra-labor'
  and tgt.id = '2026-09-25-extra-labor';

-- Both days are at the same place.
update events
set city = 'Downtown Oakland Commissary', updated_at = now()
where id in ('2026-09-23-extra-labor', '2026-09-25-extra-labor');

-- Check: these two rows should now match apart from the date.
select date, place, city, support_start, support_end, staff_needed,
       notes, aaron_note, array_length(assigned_staff, 1) as crew_on
from events
where id in ('2026-09-23-extra-labor', '2026-09-25-extra-labor')
order by date;
