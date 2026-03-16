import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, PlusCircle, Trash2, Search, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card'; // Removed CardFooter
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { BoletaFormSchema, BoletaFormValues } from '@/lib/types/invoicing'; // Removed ClientBoletaSchema, DetalleBoletaSchema
import {
  fetchClientByDocument,
  issueBoleta,
  createIncomeFromBoleta,
  getAndIncrementBoletaCorrelative
} from '@/lib/api/invoicingApi';
import { format } from 'date-fns';
import { DateMaskInput } from '@/components/ui/date-mask-input';

interface BoletaFormProps {
  // nextBoletaNumber: string | null; // Removed as it's not used
}

const PAYMENT_METHODS = [
  { value: 'BBVA Empresa', label: 'BBVA Empresa' },
  { value: 'Efectivo', label: 'Efectivo' },
  { value: 'Cuenta Fidel', label: 'Cuenta Fidel' },
];

const TIPOS_AFECTACION_IGV = [
  { value: '10', label: 'Gravado - Operación Onerosa' },
  { value: '20', label: 'Exonerado - Operación Onerosa' },
  { value: '30', label: 'Inafecto - Operación Onerosa' },
];

export default function BoletaForm({ /* nextBoletaNumber */ }: BoletaFormProps) { // Removed nextBoletaNumber from destructuring
  const [isSearchingClient, setIsSearchingClient] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<BoletaFormValues>({
    resolver: zodResolver(BoletaFormSchema),
    defaultValues: {
      serie: 'B001', // Default serie for boletas
      fecha_emision: format(new Date(), 'dd/MM/yyyy'),
      moneda: 'PEN',
      tipo_operacion: '01', // Venta interna
      metodo_envio: 'email',
      forma_pago_tipo: 'Contado',
      usuario_creacion: 'admin', // Placeholder, should come from auth
      client: {
        tipo_documento: '1', // DNI
        numero_documento: '',
        razon_social: '',
        direccion: '',
        email: '',
      },
      detalles: [{
        descripcion: 'Servicio de Consultoría',
        unidad: 'NIU',
        cantidad: 1,
        mto_valor_unitario: 100.00,
        porcentaje_igv: 18,
        tip_afe_igv: '10',
      }],
      create_income_record: true,
      income_date: format(new Date(), 'dd/MM/yyyy'), // Ensure it's always a string
      income_account: 'Efectivo',
      income_numero_operacion: '', // Initialize as empty string to avoid undefined
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'detalles',
  });

  const clientTipoDocumento = form.watch('client.tipo_documento');
  const clientNumeroDocumento = form.watch('client.numero_documento');
  const createIncomeRecord = form.watch('create_income_record');

  const handleClientSearch = async () => {
    if (!clientNumeroDocumento || clientNumeroDocumento.length < 8) return; // Basic validation
    setIsSearchingClient(true);
    try {
      const client = await fetchClientByDocument(clientNumeroDocumento);
      if (client) {
        form.setValue('client.razon_social', client.razon_social);
        form.setValue('client.direccion', client.direccion || '');
        form.setValue('client.email', client.email || '');
        form.setValue('client.id', client.id || '');
        toast.success("Cliente identificado");
      } else {
        toast.error("Cliente no encontrado");
        form.setValue('client.razon_social', '');
        form.setValue('client.direccion', '');
        form.setValue('client.email', '');
        form.setValue('client.id', '');
      }
    } catch (error) {
      toast.error("Error en la búsqueda del cliente");
    } finally {
      setIsSearchingClient(false);
    }
  };

  const onSubmit = async (values: BoletaFormValues) => {
    setIsSubmitting(true);
    try {
      // Obtener e incrementar el correlativo de boleta de forma atómica al momento de la emisión
      const finalBoletaCorrelative = await getAndIncrementBoletaCorrelative();

      const [d, m, y] = values.fecha_emision.split('/');
      const dbDate = `${y}-${m}-${d}`;

      const payload = {
        company_id: 1, // Placeholder, should come from context
        branch_id: 1,  // Placeholder, should come from context
        serie: values.serie,
        fecha_emision: dbDate,
        moneda: values.moneda,
        tipo_operacion: values.tipo_operacion,
        metodo_envio: values.metodo_envio,
        forma_pago_tipo: values.forma_pago_tipo,
        usuario_creacion: values.usuario_creacion,
        client: {
          ...values.client,
          tipo_documento: values.client.tipo_documento,
          numero_documento: values.client.numero_documento,
          razon_social: values.client.razon_social,
        },
        detalles: values.detalles.map(detalle => ({
          ...detalle,
          cantidad: parseFloat(detalle.cantidad.toString()),
          mto_valor_unitario: parseFloat(detalle.mto_valor_unitario.toString()),
          porcentaje_igv: parseFloat(detalle.porcentaje_igv.toString()),
        })),
      };

      const issueResponse = await issueBoleta(payload);

      if (!issueResponse.success) {
        throw new Error(issueResponse.message || "Error al emitir la boleta.");
      }

      toast.success(`Boleta ${finalBoletaCorrelative} emitida con éxito!`);

      // Crear registro de ingreso si está marcado
      if (values.create_income_record) {
        // Ensure income_date is a string before splitting
        const incomeDateString = values.income_date || format(new Date(), 'dd/MM/yyyy');
        const [id, im, iy] = incomeDateString.split('/');
        const incomeDbDate = `${iy}-${im}-${id}`;

        const totalAmount = values.detalles.reduce((sum, item) => sum + (item.cantidad * item.mto_valor_unitario * (1 + item.porcentaje_igv / 100)), 0);

        await createIncomeFromBoleta({
          receipt_number: finalBoletaCorrelative,
          dni: values.client.numero_documento,
          full_name: values.client.razon_social,
          amount: totalAmount,
          account: values.income_account || 'Efectivo', // Provide a default if it could be undefined
          date: incomeDbDate,
          transaction_type: 'Boleta de Venta',
          numeroOperacion: values.income_numero_operacion ? Number(values.income_numero_operacion) : null,
        });
        toast.success("Registro de ingreso creado.");
      }

      form.reset(); // Resetear el formulario
    } catch (error: any) {
      console.error("Error al procesar la boleta:", error);
      toast.error("Error: " + (error.message || "No se pudo completar la operación."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="bg-white border border-gray-100 rounded-[2.5rem] p-8 shadow-sm">
      <CardContent className="p-0">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {/* Sección de Datos Generales */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <FormField
                control={form.control}
                name="serie"
                render={({ field }) => (
                  <FormItem>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Serie</label>
                    <FormControl>
                      <Input {...field} readOnly className="h-14 bg-gray-100 border-none rounded-2xl font-bold text-gray-700" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fecha_emision"
                render={({ field }) => (
                  <FormItem>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Fecha Emisión</label>
                    <FormControl>
                      <DateMaskInput {...field} className="h-14 bg-gray-50 border-none rounded-2xl font-bold" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="moneda"
                render={({ field }) => (
                  <FormItem>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Moneda</label>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-14 bg-gray-50 border-none rounded-2xl font-bold">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="rounded-2xl">
                        <SelectItem value="PEN" className="font-bold py-3">Soles (PEN)</SelectItem>
                        <SelectItem value="USD" className="font-bold py-3">Dólares (USD)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Sección de Datos del Cliente */}
            <div className="space-y-4 border-t border-gray-100 pt-8 mt-8">
              <h3 className="text-lg font-bold text-gray-800">Datos del Cliente</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <FormField
                  control={form.control}
                  name="client.tipo_documento"
                  render={({ field }) => (
                    <FormItem>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Tipo Doc.</label>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-14 bg-gray-50 border-none rounded-2xl font-bold">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-2xl">
                          <SelectItem value="1" className="font-bold py-3">DNI</SelectItem>
                          <SelectItem value="6" className="font-bold py-3">RUC</SelectItem>
                          <SelectItem value="0" className="font-bold py-3">OTROS</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="md:col-span-2 flex gap-3">
                  <FormField
                    control={form.control}
                    name="client.numero_documento"
                    render={({ field }) => (
                      <FormItem className="flex-grow">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">N° Documento</label>
                        <FormControl>
                          <Input
                            placeholder={clientTipoDocumento === '1' ? "8 dígitos" : "N° Documento"}
                            {...field}
                            maxLength={clientTipoDocumento === '1' ? 8 : undefined}
                            className="h-14 bg-gray-50 border-none rounded-2xl text-lg font-bold"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {clientTipoDocumento === '1' && (
                    <Button
                      type="button"
                      onClick={handleClientSearch}
                      disabled={isSearchingClient || clientNumeroDocumento.length !== 8}
                      className="h-14 w-14 rounded-2xl bg-gray-900 text-white self-end"
                    >
                      {isSearchingClient ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                    </Button>
                  )}
                </div>
              </div>
              <FormField
                control={form.control}
                name="client.razon_social"
                render={({ field }) => (
                  <FormItem>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Razón Social / Nombres</label>
                    <FormControl>
                      <Input {...field} className="h-14 bg-gray-50 border-none rounded-2xl font-black text-gray-700 uppercase" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="client.direccion"
                render={({ field }) => (
                  <FormItem>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Dirección</label>
                    <FormControl>
                      <Input {...field} className="h-14 bg-gray-50 border-none rounded-2xl font-medium" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="client.email"
                render={({ field }) => (
                  <FormItem>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Email</label>
                    <FormControl>
                      <Input type="email" {...field} className="h-14 bg-gray-50 border-none rounded-2xl font-medium" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Sección de Detalles de la Venta */}
            <div className="space-y-4 border-t border-gray-100 pt-8 mt-8">
              <h3 className="text-lg font-bold text-gray-800">Detalles de la Venta</h3>
              {fields.map((item, index) => (
                <Card key={item.id} className="p-6 rounded-2xl border-gray-100 shadow-sm">
                  <CardContent className="p-0 space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-md font-semibold text-gray-700">Item {index + 1}</h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4 mr-2" /> Eliminar
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name={`detalles.${index}.descripcion`}
                      render={({ field }) => (
                        <FormItem>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Descripción</label>
                          <FormControl>
                            <Input {...field} className="h-12 bg-gray-50 border-none rounded-xl font-medium" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name={`detalles.${index}.cantidad`}
                        render={({ field }) => (
                          <FormItem>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Cantidad</label>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} className="h-12 bg-gray-50 border-none rounded-xl font-bold" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`detalles.${index}.unidad`}
                        render={({ field }) => (
                          <FormItem>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Unidad</label>
                            <FormControl>
                              <Input {...field} className="h-12 bg-gray-50 border-none rounded-xl font-bold" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`detalles.${index}.mto_valor_unitario`}
                        render={({ field }) => (
                          <FormItem>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Valor Unitario (S/.)</label>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} className="h-12 bg-gray-50 border-none rounded-xl font-bold" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={`detalles.${index}.porcentaje_igv`}
                        render={({ field }) => (
                          <FormItem>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">% IGV</label>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} className="h-12 bg-gray-50 border-none rounded-xl font-bold" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`detalles.${index}.tip_afe_igv`}
                        render={({ field }) => (
                          <FormItem>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Tipo Afectación IGV</label>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger className="h-12 bg-gray-50 border-none rounded-xl font-bold">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="rounded-xl">
                                {TIPOS_AFECTACION_IGV.map(tipo => (
                                  <SelectItem key={tipo.value} value={tipo.value} className="font-bold py-2">{tipo.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => append({ descripcion: '', unidad: 'NIU', cantidad: 1, mto_valor_unitario: 0, porcentaje_igv: 18, tip_afe_igv: '10' })}
                className="w-full h-12 rounded-2xl border-dashed border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                <PlusCircle className="h-5 w-5 mr-2" /> Añadir Item
              </Button>
            </div>

            {/* Sección de Registro de Ingreso */}
            <div className="space-y-4 border-t border-gray-100 pt-8 mt-8">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="create_income_record"
                  checked={createIncomeRecord}
                  onCheckedChange={(checked) => form.setValue('create_income_record', !!checked)}
                  className="h-5 w-5 rounded-md border-gray-300 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                />
                <label
                  htmlFor="create_income_record"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Registrar como Ingreso
                </label>
              </div>

              {createIncomeRecord && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 animate-in fade-in slide-in-from-top-2">
                  <FormField
                    control={form.control}
                    name="income_date"
                    render={({ field }) => (
                      <FormItem>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Fecha de Ingreso</label>
                        <FormControl>
                          <DateMaskInput {...field} className="h-14 bg-gray-50 border-none rounded-2xl font-bold" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="income_account"
                    render={({ field }) => (
                      <FormItem>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Cuenta de Ingreso</label>
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="income_numero_operacion"
                    render={({ field }) => (
                      <FormItem>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">N° Operación (Opcional)</label>
                        <FormControl>
                          <Input {...field} className="h-14 bg-gray-50 border-none rounded-2xl font-medium" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-16 gap-3 rounded-2xl bg-primary hover:bg-primary/90 text-white text-lg font-black shadow-xl shadow-primary/20 transition-all active:scale-[0.98]"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  Emitiendo Boleta...
                </>
              ) : (
                <>
                  <FileText className="h-6 w-6" />
                  Emitir Boleta Electrónica
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
