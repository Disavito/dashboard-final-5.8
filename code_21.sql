SELECT MAX(CAST(SUBSTRING(receipt_number FROM POSITION('-' IN receipt_number) + 1) AS INT))
FROM public.ingresos
WHERE receipt_number LIKE 'B001-%';
