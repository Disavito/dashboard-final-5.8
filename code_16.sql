-- Crear la tabla document_sequences
CREATE TABLE public.document_sequences (
    id TEXT PRIMARY KEY,
    last_number INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insertar valores iniciales para 'receipt' y 'boleta'
-- Esto asegura que las secuencias existan, si ya existen, no hará nada.
INSERT INTO public.document_sequences (id, last_number) VALUES ('receipt', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.document_sequences (id, last_number) VALUES ('boleta', 0) ON CONFLICT (id) DO NOTHING;

-- Opcional: Habilitar RLS si lo necesitas para esta tabla
-- ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
