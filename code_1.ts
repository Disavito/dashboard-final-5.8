const { error: uploadError } = await supabase.storage
    .from('socio-documents') // <-- Este es el nombre del bucket que el código intenta usar
    .upload(filePath, blob, {
      contentType: 'application/pdf',
      upsert: true
    });
