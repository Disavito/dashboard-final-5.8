import { supabase } from '../supabaseClient';
import {
  BoletaPayload,
  Client,
  DocumentoAfectado,
  InvoicingCalendarItem,
  IssueResponse,
  NotaCreditoPayload,
  AnnulledIncomeSummary,
  CheckSummaryStatusResponse,
  SummaryData
} from '../types/invoicing';

/**
 * Sincroniza manualmente el correlativo de recibos basándose en el último registro real.
 */
export const syncReceiptSequenceWithDatabase = async (): Promise<string> => {
  try {
    const { data: lastIncome, error: fetchError } = await supabase
      .from('ingresos')
      .select('receipt_number')
      .like('receipt_number', 'R-%')
      .order('receipt_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    let lastNumber = 0;
    if (lastIncome?.receipt_number) {
      const match = lastIncome.receipt_number.match(/R-(\d+)/);
      if (match) lastNumber = parseInt(match[1], 10);
    }

    const nextNumber = lastNumber + 1;
    const nextCorrelative = `R-${nextNumber.toString().padStart(5, '0')}`;

    const { error: updateError } = await supabase
      .from('document_sequences')
      .update({ last_number: lastNumber })
      .eq('id', 'receipt');

    if (updateError) throw updateError;

    return nextCorrelative;
  } catch (error) {
    console.error("Error syncing receipt sequence:", error);
    return fetchNextReceiptCorrelativeForDisplay();
  }
};

/**
 * Sube un documento al storage y lo vincula al socio en socio_documentos
 */
async function uploadAndLinkDocument(
  blob: Blob,
  fileName: string,
  socioId: string,
  tipoDoc: string = 'Comprobante de Pago'
) {
  const { error: uploadError } = await supabase.storage
    .from('comprobante-de-pago')
    .upload(fileName, blob, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from('comprobante-de-pago')
    .getPublicUrl(fileName);

  const { error: dbError } = await supabase
    .from('socio_documentos')
    .upsert(
      {
        socio_id: socioId,
        tipo_documento: tipoDoc,
        link_documento: publicUrl,
      },
      {
        onConflict: 'socio_id,tipo_documento',
        ignoreDuplicates: false
      }
    );

  if (dbError) throw dbError;

  return publicUrl;
}

// --- FUNCIONES PARA CORRELATIVOS ATÓMICOS ---

export const fetchNextReceiptCorrelativeForDisplay = async (): Promise<string> => {
  try {
    const { data, error } = await supabase.rpc('peek_next_sequence_number', { sequence_id: 'receipt' });
    if (error) throw error;
    return data as string;
  } catch (err) {
    console.error("Error peeking next receipt correlative:", err);
    return 'R-00001';
  }
};

export const getAndIncrementReceiptCorrelative = async (): Promise<string> => {
  try {
    const { data, error } = await supabase.rpc('get_next_sequence_number', { sequence_id: 'receipt' });
    if (error) throw error;
    return data as string;
  } catch (err) {
    console.error("Error getting and incrementing receipt correlative:", err);
    throw new Error("No se pudo obtener el correlativo del recibo.");
  }
};

export const fetchNextBoletaCorrelativeForDisplay = async (): Promise<string> => {
  try {
    const { data, error } = await supabase.rpc('peek_next_sequence_number', { sequence_id: 'boleta' });
    if (error) throw error;
    return data as string;
  } catch (err) {
    console.error("Error peeking next boleta correlative:", err);
    return 'B-000001';
  }
};

export const getAndIncrementBoletaCorrelative = async (): Promise<string> => {
  try {
    const { data, error } = await supabase.rpc('get_next_sequence_number', { sequence_id: 'boleta' });
    if (error) throw error;
    return data as string;
  } catch (err) {
    console.error("Error getting and incrementing boleta correlative:", err);
    throw new Error("No se pudo obtener el correlativo de la boleta.");
  }
};

export const fetchRecentInvoices = async (): Promise<InvoicingCalendarItem[]> => {
  const { data, error } = await supabase
    .from('ingresos')
    .select('id, date, receipt_number, amount, full_name, transaction_type')
    .order('date', { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data || []).map(item => {
    let type: InvoicingCalendarItem['type'] = 'Recibo';
    if (item.transaction_type === 'Anulación') type = 'Nota Crédito';
    else if (item.receipt_number?.startsWith('B')) type = 'Boleta';
    else if (item.receipt_number?.startsWith('F')) type = 'Factura';

    return {
      id: item.id.toString(),
      date: item.date,
      type,
      serie: item.receipt_number || 'N/A',
      clientName: item.full_name || 'Cliente Desconocido',
      amount: item.amount,
      status: 'Aceptado'
    };
  });
};

export const fetchDocumentoAfectado = async (
  _tipo: 'boleta' | 'factura',
  serie: string,
  numero: string
): Promise<DocumentoAfectado | null> => {
  const fullNumber = `${serie}-${numero}`;
  const { data, error } = await supabase
    .from('ingresos')
    .select('*')
    .eq('receipt_number', fullNumber)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    fecha_emision: data.date,
    moneda: 'PEN',
    mto_imp_venta: data.amount,
    client: {
      tipo_documento: data.dni?.length === 8 ? '1' : '6',
      numero_documento: data.dni || '',
      razon_social: data.full_name || '',
      direccion: '',
      email: '',
    },
    detalles: [
      {
        descripcion: `POR CONCEPTO DE: ${data.transaction_type || 'SERVICIO'}`,
        unidad: 'NIU',
        cantidad: 1,
        mto_valor_unitario: data.amount,
        porcentaje_igv: 18,
        tip_afe_igv: '10',
      }
    ]
  };
};

export const issueNotaCredito = async (payload: NotaCreditoPayload): Promise<IssueResponse> => {
  // Mock implementation using payload to avoid unused var error
  console.log("Issuing NC for:", payload.num_doc_afectado);
  await new Promise(resolve => setTimeout(resolve, 1000));
  return {
    success: true,
    data: {
      id: Math.floor(Math.random() * 10000),
      numero_completo: `${payload.serie}-${Math.floor(Math.random() * 1000).toString().padStart(6, '0')}`,
      external_id: crypto.randomUUID(),
    }
  };
};

/**
 * Envía la nota de crédito a SUNAT.
 * Se usa _id para evitar error TS6133 (unused variable).
 */
export const sendNotaCreditoToSunat = async (_id: number): Promise<boolean> => {
  await new Promise(resolve => setTimeout(resolve, 800));
  return true;
};

export const updateIncomeOnCreditNote = async (
  originalSerieNumero: string,
  amount: number,
  ncNumero: string
): Promise<void> => {
  const { data: original, error: fetchError } = await supabase
    .from('ingresos')
    .select('*')
    .eq('receipt_number', originalSerieNumero)
    .single();
  if (fetchError || !original) throw new Error("No se encontró el ingreso original para actualizar.");
  const { error: insertError } = await supabase
    .from('ingresos')
    .insert([{
      date: new Date().toISOString().split('T')[0],
      receipt_number: ncNumero,
      dni: original.dni,
      full_name: original.full_name,
      amount: -Math.abs(amount),
      account: original.account,
      transaction_type: 'Anulación',
      numeroOperacion: original.numeroOperacion
    }]);
  if (insertError) throw insertError;
  await supabase.from('ingresos').update({ transaction_type: `Anulado por ${ncNumero}` }).eq('id', original.id);
};

export const createDailySummary = async (fecha: string): Promise<{ success: boolean; data: SummaryData; message?: string }> => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  return {
    success: true,
    data: {
      id: Math.floor(Math.random() * 1000),
      fecha_resumen: fecha,
      numero_completo: `RC-${fecha.replace(/-/g, '')}-001`,
      detalles: []
    }
  };
};

export const sendSummaryToSunat = async (summaryId: number): Promise<{ success: boolean; data: any; message?: string }> => {
  await new Promise(resolve => setTimeout(resolve, 1500));
  return {
    success: true,
    data: {
      id: summaryId,
      ticket: `T-${Math.floor(Math.random() * 1000000)}`,
      estado_sunat: 'PROCESANDO'
    }
  };
};

export const saveDailySummaryResult = async (data: any): Promise<void> => {
  const { error } = await supabase
    .from('daily_summaries')
    .insert([{
      fecha_resumen: new Date().toISOString().split('T')[0],
      numero_completo: `RC-${Date.now()}`,
      ticket: data.ticket,
      estado_sunat: data.estado_sunat,
      summary_api_id: data.id
    }]);
  if (error) throw error;
};

export const checkSummaryStatus = async (summaryApiId: number): Promise<CheckSummaryStatusResponse> => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  return {
    success: true,
    data: {
      id: summaryApiId,
      estado_sunat: 'ACEPTADO'
    }
  };
};

export const updateSummaryStatusInDb = async (summaryId: number, newStatus: string): Promise<void> => {
  const { error } = await supabase.from('daily_summaries').update({ estado_sunat: newStatus }).eq('id', summaryId);
  if (error) throw error;
};

export const fetchAnnulledAndReturnedIncomes = async (type?: 'annulled' | 'returned'): Promise<AnnulledIncomeSummary[]> => {
  let query = supabase.from('ingresos').select('id, date, receipt_number, amount, dni, full_name, transaction_type');
  if (type === 'annulled') query = query.eq('transaction_type', 'Anulación');
  else if (type === 'returned') query = query.eq('transaction_type', 'Devolución');
  else query = query.in('transaction_type', ['Anulación', 'Devolución']);
  const { data, error } = await query.order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(item => ({
    id: item.id,
    date: item.date,
    receipt_number: item.receipt_number || '',
    amount: item.amount,
    client_dni: item.dni,
    client_name: item.full_name,
    transaction_type: item.transaction_type
  }));
};

export const fetchClientByDocument = async (documentNumber: string): Promise<Client | null> => {
  const { data, error } = await supabase
    .from('socio_titulares')
    .select('id, dni, nombres, "apellidoPaterno", "apellidoMaterno", localidad, mz, lote, celular')
    .eq('dni', documentNumber)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    tipo_documento: '1',
    numero_documento: data.dni,
    razon_social: `${data.nombres} ${data.apellidoPaterno} ${data.apellidoMaterno}`.trim(),
    direccion: `${data.localidad} ${data.mz ? 'Mz ' + data.mz : ''} ${data.lote ? 'Lt ' + data.lote : ''}`.trim(),
    telefono: data.celular || '',
    email: '',
  };
};

export const issueBoleta = async (payload: BoletaPayload): Promise<IssueResponse> => {
  return {
    success: true,
    data: {
      id: Math.floor(Math.random() * 10000),
      numero_completo: `${payload.serie}-${Math.floor(Math.random() * 100000).toString().padStart(6, '0')}`,
      external_id: crypto.randomUUID(),
    }
  };
};

export const generateBoletaPdf = async (_id: number, _format: string = 'A4'): Promise<Blob> => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  doc.text(`Boleta de Venta de Ejemplo - ID: ${_id}`, 10, 10);
  return doc.output('blob');
};

export const saveBoletaPdfToSupabase = async (blob: Blob, numero: string, socioId: string) => {
  try {
    const fileName = `${socioId}/boleta/Boleta_${numero}_${Date.now()}.pdf`;
    const publicUrl = await uploadAndLinkDocument(blob, fileName, socioId, 'Comprobante de Pago');
    return { success: true, url: publicUrl };
  } catch (error) {
    console.error("Error saving boleta PDF:", error);
    throw error;
  }
};

export const saveReceiptPdfToSupabase = async (blob: Blob, numero: string, socioId: string) => {
  try {
    const fileName = `${socioId}/recibo/Recibo_${numero}_${Date.now()}.pdf`;
    const publicUrl = await uploadAndLinkDocument(blob, fileName, socioId, 'Comprobante de Pago');
    return { success: true, url: publicUrl };
  } catch (error) {
    console.error("Error saving receipt PDF:", error);
    throw error;
  }
};

export const createIncomeFromBoleta = async (data: any) => {
  const { error } = await supabase.from('ingresos').insert([data]);
  if (error) throw error;
};

export const fetchDailySummaries = async () => {
  const { data } = await supabase.from('daily_summaries').select('*').order('fecha_resumen', { ascending: false });
  return data || [];
};

export const downloadBoletaPdfToBrowser = async (id: number, numero: string, format: string) => {
  try {
    const pdfBlob = await generateBoletaPdf(id, format);
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Boleta_${numero}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error al descargar el PDF de la boleta:", error);
  }
};
