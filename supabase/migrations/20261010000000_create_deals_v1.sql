BEGIN;

CREATE TABLE public.deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    deal_name TEXT NOT NULL,
    tenant_name TEXT,
    deal_type TEXT NOT NULL DEFAULT 'new_lease',
    status TEXT NOT NULL DEFAULT 'active',
    market TEXT,
    target_square_feet NUMERIC,
    notes TEXT,
    created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT deals_deal_name_not_blank CHECK (trim(deal_name) <> ''),
    CONSTRAINT deals_deal_type_valid CHECK (deal_type IN ('new_lease', 'renewal', 'relocation', 'expansion')),
    CONSTRAINT deals_status_valid CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled')),
    CONSTRAINT deals_target_sq_ft_positive CHECK (target_square_feet IS NULL OR target_square_feet > 0)
);

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deals_select_policy" ON public.deals
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.organization_memberships AS om
        WHERE om.organization_id = deals.organization_id
          AND om.user_id = (SELECT auth.uid())
    )
);

CREATE POLICY "deals_insert_policy" ON public.deals
FOR INSERT
TO authenticated
WITH CHECK (
    (
        EXISTS (
            SELECT 1
            FROM public.organization_memberships AS om
            WHERE om.organization_id = deals.organization_id
              AND om.user_id = (SELECT auth.uid())
              AND om.role IN ('admin', 'member')
        )
    )
    AND (created_by = auth.uid())
);

CREATE POLICY "deals_update_policy" ON public.deals
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.organization_memberships AS om
        WHERE om.organization_id = deals.organization_id
          AND om.user_id = (SELECT auth.uid())
          AND om.role IN ('admin', 'member')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.organization_memberships AS om
        WHERE om.organization_id = deals.organization_id
          AND om.user_id = (SELECT auth.uid())
          AND om.role IN ('admin', 'member')
    )
);

CREATE OR REPLACE FUNCTION public.trigg_deals_enforce_ownership()
RETURNS TRIGGER
SECURITY INVOKER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.id IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'Immutable field modified: id';
    END IF;
    IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'Immutable field modified: organization_id';
    END IF;
    IF OLD.created_by IS DISTINCT FROM NEW.created_by THEN
        RAISE EXCEPTION 'Immutable field modified: created_by';
    END IF;
    IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Immutable field modified: created_at';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deals_enforce_ownership
BEFORE UPDATE ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.trigg_deals_enforce_ownership();

REVOKE ALL ON TABLE public.deals FROM PUBLIC;
REVOKE ALL ON TABLE public.deals FROM anon;
REVOKE DELETE ON TABLE public.deals FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.deals TO authenticated;

CREATE INDEX idx_deals_org_status ON public.deals(organization_id, status);

COMMIT;