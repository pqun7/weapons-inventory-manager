begin;

-- Segment sales by real catalogue attributes: weapon type (for example,
-- Shotgun), ammunition caliber, and accessory type. Broad item categories are
-- retained only as localized UI fallbacks when catalogue data is incomplete.
do $$
declare
  definition text;
  upgraded text;
begin
  select pg_get_functiondef('public.dashboard_analytics(date,date)'::regprocedure)
  into definition;

  upgraded := replace(
    definition,
    '      coalesce(nullif(line.value ->> ''itemType'', ''''), ''weapon'') as category,',
    '      coalesce(nullif(line.value ->> ''itemType'', ''''), ''weapon'') as category,
      case coalesce(nullif(line.value ->> ''itemType'', ''''), ''weapon'')
        when ''weapon'' then coalesce((
          select weapon_type.label
          from public.weapons as weapon
          join public.weapon_types as weapon_type on weapon_type.id = weapon.weapon_type_id
          where weapon.id = line.value ->> ''itemId''
        ), ''weapon'')
        when ''ammunition'' then coalesce((
          select nullif(ammunition.caliber, '''')
          from public.ammunition as ammunition
          where ammunition.id = line.value ->> ''itemId''
        ), ''ammunition'')
        when ''accessory'' then coalesce((
          select nullif(accessory.type, '''')
          from public.accessories as accessory
          where accessory.id = line.value ->> ''itemId''
        ), ''accessory'')
      end as segment,'
  );
  upgraded := replace(
    upgraded,
    '    select
      line.category,
      sum(line.allocated_revenue)::numeric as revenue,',
    '    select
      line.category,
      line.segment,
      sum(line.allocated_revenue)::numeric as revenue,'
  );
  upgraded := replace(
    upgraded,
    '    group by line.category
  ),
  product_rows as (',
    '    group by line.category, line.segment
  ),
  product_rows as ('
  );
  upgraded := replace(
    upgraded,
    '''category'', category.category, ''revenue'', round(category.revenue, 4),',
    '''category'', category.category, ''segment'', category.segment, ''revenue'', round(category.revenue, 4),'
  );

  if position('end as segment' in definition) = 0 and upgraded = definition then
    raise exception 'dashboard_analytics segment upgrade did not match the installed function';
  end if;
  if upgraded <> definition then
    execute upgraded;
  end if;
end
$$;

commit;
