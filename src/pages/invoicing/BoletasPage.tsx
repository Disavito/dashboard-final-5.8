import { useState, useEffect, useCallback } from 'react';
import BoletaForm from '@/components/invoicing/BoletaForm';
import { CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { fetchNextBoletaCorrelativeForDisplay } from '@/lib/api/invoicingApi';

function BoletasPage() {
  const [nextBoletaNumber, setNextBoletaNumber] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadCorrelative = useCallback(async (silent = false) => {
    if (!silent) setIsSyncing(true);
    try {
      const correlative = await fetchNextBoletaCorrelativeForDisplay();
      setNextBoletaNumber(correlative);
      if (!silent) toast.success("Número de boleta sincronizado");
    } catch (error) {
      toast.error("Error al sincronizar correlativo de boleta");
    } finally {
      if (!silent) setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    loadCorrelative(true);

    // Configurar la suscripción en tiempo real a la tabla document_sequences para boletas
    const channel = supabase
      .channel('document_sequences_boleta_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'document_sequences', filter: 'id=eq.boleta' },
        (payload) => {
          console.log('Realtime update for boleta sequence:', payload);
          loadCorrelative(true); // Refrescar el correlativo mostrado
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadCorrelative]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <CardHeader className="p-0">
          <CardTitle className="text-2xl font-bold text-primary">
            Emisión de Boleta de Venta Electrónica {nextBoletaNumber && <span className="text-accent text-xl">({nextBoletaNumber})</span>}
          </CardTitle>
          <CardDescription className="text-textSecondary">
            Complete los datos del cliente y los detalles de la venta para generar y enviar la boleta a la SUNAT.
          </CardDescription>
        </CardHeader>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => loadCorrelative(false)}
          disabled={isSyncing}
          className="rounded-xl gap-2"
        >
          {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {nextBoletaNumber ? `Sincronizar (${nextBoletaNumber})` : 'Sincronizar'}
        </Button>
      </div>
      
      <BoletaForm /> {/* Removed nextBoletaNumber prop */}
    </div>
  );
}

export default BoletasPage;
