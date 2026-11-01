// Marco de teléfono estilo Android (390×844 — punch-hole centrado,
// radio tipo Pixel, barra de gestos inferior) alrededor del preview
// web que sirve Metro en dev — el iframe ve el viewport mobile.
// `url` llega del dev-run trackeado (devLog.urls o procs del toolchain).
export default function MobilePreview({ url }) {
  return (
    <div className="mx-auto w-fit">
      <div className="rounded-[2.2rem] bg-slate-950 p-[8px] shadow-[0_0_40px_-8px_rgb(var(--a500)/.5)] ring-1 ring-accent-500/60">
        <div className="relative h-[844px] w-[390px] overflow-hidden rounded-[1.7rem] bg-black">
          {/* cámara punch-hole (estilo Android) */}
          <div className="absolute left-1/2 top-2.5 z-10 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-slate-950 ring-1 ring-slate-800" />
          <iframe
            title="preview móvil"
            src={url}
            className="h-full w-full border-0"
          />
          {/* barra de gestos inferior (nav gesture Android) */}
          <div className="absolute bottom-1.5 left-1/2 z-10 h-1 w-32 -translate-x-1/2 rounded-full bg-slate-500/60" />
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">
        preview web · {url}
      </p>
    </div>
  );
}
