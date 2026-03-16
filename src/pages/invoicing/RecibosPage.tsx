import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Search, FileText, Wallet, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ReciboPagoFormSchema, ReciboPagoFormValues } from '@/lib/types/invoicing';
import { 
  fetchClientByDocument, 
  fetchNextReceiptCorrelativeForDisplay,
  getAndIncrementReceiptCorrelative,
  saveReceiptPdfToSupabase,
  syncReceiptSequenceWithDatabase
} from '@/lib/api/invoicingApi';
import { Client } from '@/lib/types/invoicing';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { DateMaskInput } from '@/components/ui/date-mask-input';
import { cn } from '@/lib/utils';

const PAYMENT_METHODS = [
  { value: 'BBVA Empresa', label: 'BBVA Empresa' },
  { value: 'Efectivo', label: 'Efectivo' },
  { value: 'Cuenta Fidel', label: 'Cuenta Fidel' },
];

export default function RecibosPage() {
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [clientData, setClientData] = useState<Client | null>(null);
  const [nextReceiptNumber, setNextReceiptNumber] = useState<string | null>(null);

  const form = useForm<ReciboPagoFormValues>({
    resolver: zodResolver(ReciboPagoFormSchema),
    defaultValues: {
      dni: '',
      client_name: '',
      client_id: null,
      fecha_emision: format(new Date(), 'dd/MM/yyyy'),
      monto: 250.00,
      concepto: 'Elaboracion de Expediente Tecnico',
      metodo_pago: 'Efectivo',
      numero_operacion: '',
      is_payment_observed: false,
      payment_observation_detail: '',
    },
  });

  const dni = form.watch('dni');
  const metodoPago = form.watch('metodo_pago');
  const isObserved = form.watch('is_payment_observed');
  const showOperationNumber = metodoPago === 'BBVA Empresa' || metodoPago === 'Cuenta Fidel';

  const loadCorrelative = useCallback(async (silent = false) => {
    if (!silent) setIsSyncing(true);
    try {
      const correlative = silent 
        ? await fetchNextReceiptCorrelativeForDisplay() 
        : await syncReceiptSequenceWithDatabase();
      
      setNextReceiptNumber(correlative);
      if (!silent) toast.success(`Secuencia sincronizada: Próximo recibo ${correlative}`);
    } catch (error) {
      toast.error("Error al sincronizar correlativo");
    } finally {
      if (!silent) setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    loadCorrelative(true);
    const channel = supabase
      .channel('document_sequences_receipt_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'document_sequences', filter: 'id=eq.receipt' },
        () => loadCorrelative(true)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadCorrelative]);

  const handleDniSearch = async () => {
    if (!dni || dni.length !== 8) return;
    setIsSearching(true);
    try {
      const client = await fetchClientByDocument(dni);
      if (client) {
        setClientData(client);
        form.setValue('client_name', client.razon_social);
        form.setValue('client_id', client.id || null);
        toast.success("Socio identificado");
      } else {
        toast.error("Socio no encontrado");
      }
    } catch (error) {
      toast.error("Error en la búsqueda");
    } finally {
      setIsSearching(false);
    }
  };

  const onSubmit = async (values: ReciboPagoFormValues) => {
    if (!clientData?.id) {
      toast.error("Debe identificar a un socio primero");
      return;
    }

    setIsSubmitting(true);
    try {
      const finalCorrelative = await getAndIncrementReceiptCorrelative();
      const [d, m, y] = values.fecha_emision.split('/');
      const dbDate = `${y}-${m}-${d}`;

      const receiptData = {
        correlative: finalCorrelative,
        client_full_name: clientData.razon_social,
        client_dni: clientData.numero_documento,
        fecha_emision: dbDate,
        monto: values.monto,
        concepto: values.concepto,
        metodo_pago: values.metodo_pago,
        numero_operacion: values.numero_operacion,
      };
      
      const { generateReceiptPdf } = await import('@/lib/receiptPdfGenerator');
      const pdfBlob = await generateReceiptPdf(receiptData);

      await saveReceiptPdfToSupabase(pdfBlob, finalCorrelative, clientData.id);

      const incomeData: any = {
        receipt_number: finalCorrelative,
        dni: values.dni,
        full_name: clientData.razon_social,
        amount: values.monto,
        account: values.metodo_pago,
        date: dbDate,
        transaction_type: 'Recibo de Pago',
        numeroOperacion: showOperationNumber ? Number(values.numero_operacion) : null,
        // CRITICAL FIX: Removed 'is_payment_observed' and 'payment_observation_detail'
        // as they belong to 'socio_titulares' table, not 'ingresos'.
        // If these fields need to be stored, a separate update to 'socio_titulares'
        // or a dedicated 'pagos' table linked to 'ingresos' should be implemented.
      };

      const { error: insertError } = await supabase.from('ingresos').insert(incomeData);
      if (insertError) throw insertError;

      // If payment is observed, update socio_titulares
      if (values.is_payment_observed && clientData.id) {
        const { error: updateSocioError } = await supabase
          .from('socio_titulares')
          .update({
            is_payment_observed: true,
            payment_observation_detail: values.payment_observation_detail
          })
          .eq('id', clientData.id);

        if (updateSocioError) {
          console.error("Error updating socio_titulares with observation:", updateSocioError);
          toast.error("Error al guardar la observación del pago en el socio.");
        } else {
          toast.success("Observación de pago guardada en el socio.");
        }
      }


      toast.success(`Recibo ${finalCorrelative} generado y vinculado`);

      const url = window.URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${finalCorrelative}.pdf`;
      link.click();

      form.reset({
        ...form.getValues(),
        dni: '',
        client_name: '',
        client_id: null,
        numero_operacion: '',
        is_payment_observed: false,
        payment_observation_detail: '',
      });
      setClientData(null);
    } catch (error: any) {
      toast.error("Error: " + (error.message || "No se pudo completar"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-[#9E7FFF]/10 rounded-2xl">
            <Wallet className="h-7 w-7 text-[#9E7FFF]" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">
              Emitir Recibo {nextReceiptNumber && <span className="text-[#9E7FFF] text-2xl">({nextReceiptNumber})</span>}
            </h1>
            <p className="text-sm text-gray-500 font-medium">Vinculación automática con Socio Documentos.</p>
          </div>
        </div>
        
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => loadCorrelative(false)}
          disabled={isSyncing}
          className="rounded-xl gap-2 border-[#9E7FFF]/20 hover:bg-[#9E7FFF]/5"
        >
          {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sincronizar Correlativo
        </Button>
      </div>

      <div className="bg-white border border-gray-100 rounded-[2.5rem] p-8 shadow-sm">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="md:col-span-2">
                <FormField
                  control={form.control}
                  name="dni"
                  render={({ field }) => (
                    <FormItem>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">DNI del Socio</label>
                      <div className="flex gap-3">
                        <FormControl>
                          <Input 
                            placeholder="8 dígitos" 
                            {...field} 
                            maxLength={8} 
                            className="h-14 bg-gray-50 border-none rounded-2xl text-lg font-bold" 
                          />
                        </FormControl>
                        <Button 
                          type="button" 
                          onClick={handleDniSearch} 
                          disabled={isSearching || dni.length !== 8}
                          className="h-14 w-14 rounded-2xl bg-gray-900 text-white"
                        >
                          {isSearching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="fecha_emision"
                render={({ field }) => (
                  <FormItem>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Fecha Emisión</label>
                    <FormControl>
                      <DateMaskInput 
                        {...field} 
                        className="h-14 bg-gray-50 border-none rounded-2xl font-bold" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="client_name"
              render={({ field }) => (
                <FormItem>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Nombre del Titular</label>
                  <FormControl>
                    <Input {...field} readOnly className="h-14 bg-gray-100 border-none rounded-2xl font-black text-gray-700 uppercase" />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <FormField
                  control={form.control}
                  name="monto"
                  render={({ field }) => (
                    <FormItem>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Monto Total (S/.)</label>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01" 
                          {...field} 
                          onChange={e => field.onChange(parseFloat(e.target.value))} 
                          className="h-14 bg-gray-50 border-none rounded-2xl font-black text-2xl text-[#9E7FFF]" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="metodo_pago"
                  render={({ field }) => (
                    <FormItem>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Método de Pago</label>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-14 bg-gray-50 border-none rounded-2xl font-bold">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-2xl">
                          {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value} className="font-bold py-3">{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
            </div>

            <FormField
              control={form.control}
              name="concepto"
              render={({ field }) => (
                <FormItem>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Concepto del Pago</label>
                  <FormControl>
                    <Input {...field} className="h-14 bg-gray-50 border-none rounded-2xl font-medium" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showOperationNumber && (
              <FormField
                control={form.control}
                name="numero_operacion"
                render={({ field }) => (
                  <FormItem className="animate-in fade-in slide-in-from-top-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">N° de Operación Bancaria</label>
                    <FormControl>
                      <Input {...field} className="h-14 bg-[#F0EEFF] border-none rounded-2xl font-mono font-bold text-[#9E7FFF]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* SECCIÓN DE PAGO OBSERVADO */}
            <div className={cn(
              "p-6 rounded-[2rem] transition-all duration-300 border-2",
              isObserved ? "bg-amber-50 border-amber-200" : "bg-gray-50/50 border-transparent"
            )}>
              <FormField
                control={form.control}
                name="is_payment_observed"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="h-6 w-6 rounded-lg border-gray-300 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-sm font-black text-gray-700 uppercase tracking-tight flex items-center gap-2">
                        <AlertCircle className={cn("h-4 w-4", isObserved ? "text-amber-600" : "text-gray-400")} />
                        Observar este pago
                      </FormLabel>
                    </div>
                  </FormItem>
                )}
              />

              {isObserved && (
                <FormField
                  control={form.control}
                  name="payment_observation_detail"
                  render={({ field }) => (
                    <FormItem className="mt-4 animate-in zoom-in-95 duration-200">
                      <FormControl>
                        <Textarea 
                          placeholder="Describa el motivo de la observación (ej. Monto incompleto, falta firma, etc.)"
                          className="min-h-[100px] bg-white border-amber-100 rounded-2xl focus:ring-amber-500/20 font-medium text-amber-900 placeholder:text-amber-300"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full h-16 gap-3 rounded-2xl bg-[#9E7FFF] hover:bg-[#8B6EEF] text-white text-lg font-black shadow-xl shadow-[#9E7FFF]/20 transition-all active:scale-[0.98]" 
              disabled={isSubmitting || !clientData}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <FileText className="h-6 w-6" />
                  Generar y Vincular Recibo
                </>
              )}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
