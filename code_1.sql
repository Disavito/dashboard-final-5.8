ALTER TABLE public.ingresos
ADD COLUMN is_payment_observed BOOLEAN DEFAULT FALSE;

ALTER TABLE public.ingresos
ADD COLUMN payment_observation_detail TEXT;
