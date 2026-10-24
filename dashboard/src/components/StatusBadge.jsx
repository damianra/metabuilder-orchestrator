import { statusMeta } from '../util.js';

export default function StatusBadge({ status }) {
  const meta = statusMeta(status);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
