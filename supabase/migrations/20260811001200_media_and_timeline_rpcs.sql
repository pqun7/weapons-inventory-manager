begin;

create or replace function public.append_weapon_image(p_weapon_id text, p_image_data_url text)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.can_change_inventory() then
    raise exception using errcode = '42501', message = 'inventory permission is required';
  end if;
  if p_image_data_url is null or p_image_data_url !~ '^data:image/[a-zA-Z0-9.+-]+;base64,' then
    raise exception using errcode = '22023', message = 'a base64 image data URL is required';
  end if;
  update public.weapons as w
  set images = w.images || jsonb_build_array(to_jsonb(p_image_data_url))
  where w.id = p_weapon_id and w.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'weapon not found';
  end if;
end
$$;

create or replace function public.add_shipment_timeline_event(
  p_shipment_id text,
  p_event_type text,
  p_notes text
)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare
  actor_id text;
  actor_name text;
begin
  if not public.can_manage_shipments() then
    raise exception using errcode = '42501', message = 'shipment permission is required';
  end if;
  if p_event_type not in (
    'ShipmentCreated', 'CarrierAssigned', 'DelayedAlert', 'Arrived',
    'ItemsIntakeCompleted', 'DocumentsUploaded', 'StatusChanged', 'MetadataUpdated'
  ) then
    raise exception using errcode = '22023', message = 'invalid shipment event type';
  end if;
  select u.id, u.name into actor_id, actor_name
  from public.users as u
  where u.auth_user_id = auth.uid() and u.is_active
  limit 1;
  if actor_id is null then
    raise exception using errcode = '42501', message = 'active application user is required';
  end if;
  update public.shipments as s
  set timeline = s.timeline || jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid()::text,
    'timestamp', now(),
    'status', s.status,
    'userId', actor_id,
    'userName', actor_name,
    'notes', coalesce(p_notes, ''),
    'eventType', p_event_type
  ))
  where s.id = p_shipment_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'shipment not found';
  end if;
end
$$;

revoke all on function public.append_weapon_image(text, text) from public, anon;
revoke all on function public.add_shipment_timeline_event(text, text, text) from public, anon;
grant execute on function public.append_weapon_image(text, text) to authenticated;
grant execute on function public.add_shipment_timeline_event(text, text, text) to authenticated;

commit;
