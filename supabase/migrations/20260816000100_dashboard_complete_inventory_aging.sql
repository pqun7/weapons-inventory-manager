begin;

-- The dashboard originally returned only twelve prioritized inventory rows.
-- Aging summary cards now open a product dialog, so the analytical payload
-- must include every inventory row for its filtered list to match the totals.
do $$
declare
  definition text;
  upgraded text;
begin
  select pg_get_functiondef('public.dashboard_analytics(date,date)'::regprocedure)
  into definition;

  upgraded := replace(
    definition,
    '          limit 12
        ) as item',
    '        ) as item'
  );

  if upgraded = definition then
    raise exception 'dashboard_analytics inventory row limit upgrade did not match the installed function';
  end if;

  execute upgraded;
end
$$;

commit;
