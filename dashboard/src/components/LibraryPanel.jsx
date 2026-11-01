import { useEffect, useState } from 'react';
import { Archive, LoaderCircle } from 'lucide-react';
import { api } from '../api.js';
import LibraryCard from './LibraryCard.jsx';

// Biblioteca de diseños archivados (v15) — sección dentro de la
// pantalla de "nuevo diseño" de los tabs Diseñar/Mobile. Las cards
// (LibraryCard, compartida con el tab Archivados) ofrecen:
//   · Restaurar            → devuelve la sesión a su tab (same-kind)
//   · Usar como referencia → crea un diseño NUEVO con el código
//                            archivado en .reference/<slug>/ + spec
//                            inyectado al prompt del agente
//   · Copiar prompt        → spec de diseño al portapapeles
//   · Eliminar             → borra la entrada de design-library/
export default function LibraryPanel({ onRestore, onReference, refreshKey = 0 }) {
  const [items, setItems] = useState(null);

  const load = () => api.library().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, [refreshKey]);

  if (items === null) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <LoaderCircle size={13} className="animate-spin" /> biblioteca…
      </p>
    );
  }
  if (items.length === 0) return null; // sin entradas — el panel no molesta

  return (
    <div className="mt-4">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
        <Archive size={13} className="text-accent-500" /> Diseños archivados
      </h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <LibraryCard
            key={it.slug}
            it={it}
            onRestore={onRestore}
            onReference={onReference}
            onDeleted={load}
          />
        ))}
      </div>
    </div>
  );
}
