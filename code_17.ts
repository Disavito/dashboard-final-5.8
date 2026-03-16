const { error: dbError } = await supabase
  .from('socio_documentos')
  .upsert(
    {
      socio_id: socioId,
      tipo_documento: tipoDoc, // Que será 'Comprobante de Pago'
      link_documento: publicUrl,
    },
    {
      onConflict: 'socio_id,tipo_documento', // Esta es la clave para identificar la fila existente
      ignoreDuplicates: false // Asegura que se actualice en caso de conflicto
    }
  );
