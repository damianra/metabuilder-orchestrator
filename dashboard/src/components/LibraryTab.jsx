import { useEffect, useState } from 'react';
import { Archive, LoaderCircle } from 'lucide-react';
import { api } from '../api.js';
import LibraryCard from './LibraryCard.jsx';

// Tab "Archivados" (#/archivados) — la biblioteca completa como vista
// propia (antes solo vivía dentro de "nuevo diseño"). Cada card abre el
// detalle #/lib/<slug>; las acciones restauran/navegan al tab que
// corresponde por kind (web → Diseñar, mobile → Mobile).
export default function LibraryTab() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.library().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  // Restaurar es same-kind — el restore devuelve la sesión a su
  // workspace y navegamos al tab que la retoma.
  const goTab = (it) => {
    window.location.hash = it.kind === 'mobile' ? '#/mobile' : '#/';
  };

  const restore = (it) => goTab(it);

  // Referencia same-kind: crea la sesión nueva con .reference/<slug>/ +
  // spec inyectado y navega al tab que la atiende.
  const reference = async (it) => {
    setError(null);
    try {
      const r =
        it.kind === 'mobile'
          ? await api.createMobile(it.slug)
          : await api.createDesign(undefined, 'vite-react', it.slug);
      if (!r?.ok) return setError(r?.error ?? 'no se pudo crear el diseño');
      goTab(it);
    } catch (e) {
      setError(e.message);
    }
  };

  if (items === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-400">
        <LoaderCircle size={14} className="animate-spin" /> cargando biblioteca…
      </p>
    );
  }

  return (
    <section>
      <h2 className="flex items-center gap-2 font-display text-lg text-accent-300">
        <Archive size={18} /> Archivados
        <span className="text-xs font-normal text-slate-500">
          ({items.length} diseño{items.length === 1 ? '' : 's'})
        </span>
      </h2>
      {error && (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 ring-1 ring-red-500/40">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          No hay diseños archivados — archivá uno desde los tabs Diseñar app o Mobile.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => (
            <LibraryCard
              key={it.slug}
              it={it}
              onOpen={(e) => {
                window.location.hash = `#/lib/${e.slug}`;
              }}
              onRestore={restore}
              onReference={reference}
              onDeleted={load}
            />
          ))}
        </div>
      )}
    </section>
  );
}
