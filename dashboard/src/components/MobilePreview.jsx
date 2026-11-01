// Marco de teléfono (390×844, notch) alrededor del preview web que
// sirve Metro en dev — el iframe ve exactamente el viewport mobile.
// `url` llega del dev-run trackeado (devLog.urls o procs del toolchain).
export default function MobilePreview({ url }) {
  return (
    <div className="mx-auto w-fit">
      <div className="rounded-[2.8rem] bg-slate-950 p-[10px] shadow-[0_0_40px_-8px_rgb(var(--a500)/.5)] ring-1 ring-accent-500/60">
        <div className="relative h-[844px] w-[390px] overflow-hidden rounded-[2.3rem] bg-black">
          {/* notch */}
          <div className="absolute left-1/2 top-2 z-10 h-6 w-28 -translate-x-1/2 rounded-full bg-slate-950" />
          <iframe
            title="preview móvil"
            src={url}
            className="h-full w-full border-0"
          />
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">
        preview web · {url}
      </p>
    </div>
  );
}
