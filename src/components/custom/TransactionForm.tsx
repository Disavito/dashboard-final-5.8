import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2, Save, X, AlertCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { Ingreso } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDebounce } from 'use-debounce';

const transactionSchema = z.object({
  date: z.string().min(1, 'La fecha es requerida'),
  receipt_number: z.string().min(1, 'El número de recibo es requerido'),
  dni: z.string().min(8, 'DNI inválido').max(8, 'DNI inválido'),
  full_name: z.string().min(1, 'El nombre es requerido'),
  amount: z.number().min(0.01, 'El monto debe ser mayor a 0'),
  account: z.string().min(1, 'La cuenta es requerida'),
  transaction_type: z.string().min(1, 'El tipo es requerido'),
  numeroOperacion: z.number().optional().nullable(),
  is_payment_observed: z.boolean().default(false),
  payment_observation_detail: z.string().optional().nullable(),
});

type TransactionFormValues = z.infer<typeof transactionSchema>;

interface TransactionFormProps {
  initialData?: Ingreso;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TransactionForm({ initialData, onClose, onSuccess }: TransactionFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSearchingDni, setIsSearchingDni] = useState(false);
  const [dniNotFound, setDniNotFound] = useState(false);

  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      date: initialData?.date || new Date().toISOString().split('T')[0],
      receipt_number: initialData?.receipt_number || '',
      dni: initialData?.dni || '',
      full_name: initialData?.full_name || '',
      amount: initialData?.amount || 0,
      account: initialData?.account || 'Efectivo',
      transaction_type: initialData?.transaction_type || 'Ingreso',
      numeroOperacion: initialData?.numeroOperacion || null,
      // Si estamos editando, intentamos sacar la observación del socio relacionado
      is_payment_observed: initialData?.socio_titulares?.is_payment_observed || false,
      payment_observation_detail: initialData?.socio_titulares?.payment_observation_detail || '',
    },
  });

  const isObserved = form.watch('is_payment_observed');
  const dniValue = form.watch('dni');
  const [debouncedDni] = useDebounce(dniValue, 500);

  useEffect(() => {
    const fetchSocioData = async () => {
      if (debouncedDni && debouncedDni.length === 8) {
        setIsSearchingDni(true);
        setDniNotFound(false);
        try {
          const { data, error } = await supabase
            .from('socio_titulares')
            .select('nombres, apellidoPaterno, apellidoMaterno, is_payment_observed, payment_observation_detail')
            .eq('dni', debouncedDni)
            .single();

          if (error && error.code !== 'PGRST116') throw error;

          if (data) {
            const fullName = `${data.nombres} ${data.apellidoPaterno} ${data.apellidoMaterno}`.trim();
            form.setValue('full_name', fullName, { shouldValidate: true });
            // También actualizamos el estado de observación basado en el socio encontrado
            form.setValue('is_payment_observed', data.is_payment_observed || false);
            form.setValue('payment_observation_detail', data.payment_observation_detail || '');
            setDniNotFound(false);
          } else {
            form.setValue('full_name', '', { shouldValidate: true });
            setDniNotFound(true);
          }
        } catch (error: any) {
          console.error('Error fetching socio:', error.message);
          setDniNotFound(true);
        } finally {
          setIsSearchingDni(false);
        }
      }
    };

    if (debouncedDni !== initialData?.dni) {
      fetchSocioData();
    }
  }, [debouncedDni, form, initialData?.dni]);

  const onSubmit = async (values: TransactionFormValues) => {
    setIsSubmitting(true);
    try {
      // 1. Separar los datos de Ingreso de los datos de Socio
      const { is_payment_observed, payment_observation_detail, ...incomeData } = values;

      // 2. Guardar/Actualizar el Ingreso
      let incomeError;
      if (initialData) {
        const { error } = await supabase
          .from('ingresos')
          .update(incomeData)
          .eq('id', initialData.id);
        incomeError = error;
      } else {
        const { error } = await supabase
          .from('ingresos')
          .insert([incomeData]);
        incomeError = error;
      }

      if (incomeError) throw incomeError;

      // 3. Actualizar el estado del Socio (is_payment_observed)
      const { error: socioError } = await supabase
        .from('socio_titulares')
        .update({
          is_payment_observed,
          payment_observation_detail: is_payment_observed ? payment_observation_detail : null
        })
        .eq('dni', values.dni);

      if (socioError) {
        console.error('Error al actualizar estado del socio:', socioError);
        toast.warning('Ingreso guardado, pero no se pudo actualizar el estado del socio');
      } else {
        toast.success('Registro procesado correctamente');
      }

      onSuccess();
    } catch (error: any) {
      toast.error('Error al guardar: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Fecha</FormLabel>
                <FormControl>
                  <Input type="date" {...field} className="h-12 bg-slate-50 border-none rounded-xl font-medium" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="receipt_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nº Recibo</FormLabel>
                <FormControl>
                  <Input placeholder="R-00001" {...field} className="h-12 bg-slate-50 border-none rounded-xl font-mono font-bold" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="dni"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400">DNI</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input 
                      placeholder="8 dígitos" 
                      {...field} 
                      maxLength={8} 
                      className="pl-10 h-12 bg-slate-50 border-none rounded-xl font-mono" 
                    />
                    {isSearchingDni ? (
                      <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 animate-spin" />
                    ) : (
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    )}
                  </div>
                </FormControl>
                <FormMessage />
                {dniNotFound && debouncedDni.length === 8 && (
                  <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> DNI no encontrado.
                  </p>
                )}
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="full_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nombre Completo</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="Nombre del socio" 
                    {...field} 
                    className="h-12 bg-slate-50 border-none rounded-xl font-bold uppercase" 
                    readOnly={isSearchingDni || (dniValue.length === 8 && !dniNotFound)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Monto (S/.)</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    step="0.01" 
                    placeholder="0.00" 
                    {...field} 
                    onChange={e => field.onChange(parseFloat(e.target.value))}
                    className="h-12 bg-slate-50 border-none rounded-xl font-black text-indigo-600" 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="account"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Cuenta / Método</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="h-12 bg-slate-50 border-none rounded-xl font-medium">
                      <SelectValue placeholder="Seleccionar cuenta" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="Efectivo">Efectivo</SelectItem>
                    <SelectItem value="BBVA Empresa">BBVA Empresa</SelectItem>
                    <SelectItem value="Cuenta Fidel">Cuenta Fidel</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="transaction_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo de Transacción</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="h-12 bg-slate-50 border-none rounded-xl font-medium">
                      <SelectValue placeholder="Seleccionar tipo" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="Ingreso">Ingreso</SelectItem>
                    <SelectItem value="Recibo de Pago">Recibo de Pago</SelectItem>
                    <SelectItem value="Gasto">Gasto</SelectItem>
                    <SelectItem value="Devolución">Devolución</SelectItem>
                    <SelectItem value="Anulación">Anulación</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="numeroOperacion"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nº Operación (Opcional)</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    placeholder="Ej: 123456" 
                    value={field.value || ''} 
                    onChange={e => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                    className="h-12 bg-slate-50 border-none rounded-xl font-mono" 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className={cn(
          "p-6 rounded-2xl transition-all duration-300 border-2",
          isObserved ? "bg-amber-50 border-amber-200" : "bg-slate-50/50 border-transparent"
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
                    className="h-6 w-6 rounded-lg border-slate-300 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel className="text-sm font-black text-slate-700 uppercase tracking-tight flex items-center gap-2">
                    <AlertCircle className={cn("h-4 w-4", isObserved ? "text-amber-600" : "text-slate-400")} />
                    Observar este socio
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
                      placeholder="Describa el motivo de la observación del socio..."
                      className="min-h-[80px] bg-white border-amber-100 rounded-xl focus:ring-amber-500/20 font-medium text-amber-900"
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <Button 
            type="button" 
            variant="outline" 
            onClick={onClose} 
            className="flex-1 h-12 rounded-xl font-bold border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <X className="h-4 w-4 mr-2" /> Cancelar
          </Button>
          <Button 
            type="submit" 
            disabled={isSubmitting}
            className="flex-1 h-12 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-100"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <><Save className="h-4 w-4 mr-2" /> Guardar Registro</>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
