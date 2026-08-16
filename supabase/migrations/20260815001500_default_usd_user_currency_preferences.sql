alter table public.user_preferences
  alter column display_currency set default 'USD';

update public.user_preferences
set display_currency = 'USD',
    updated_at = now()
where display_currency is null
   or btrim(display_currency) = '';

alter table public.user_preferences
  alter column display_currency set not null;

comment on column public.user_preferences.display_currency is
  'Per-user display currency. Defaults to USD and remains independently configurable by each user.';
