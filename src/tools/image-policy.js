// Fuentes de imágenes permitidas en apps generadas — licencia que
// permite uso comercial + redistribución (la app puede venderse).
// Agregar una fuente = una línea acá; `writeAgentsMd` la renderiza en
// la regla de imágenes del AGENTS.md generado ({{imageSources}}).
export const IMAGE_SOURCES = [
  { domain: 'images.unsplash.com', label: 'Unsplash', license: 'Unsplash License' },
  { domain: 'images.pexels.com', label: 'Pexels', license: 'Pexels License' },
  { domain: 'cdn.pixabay.com', label: 'Pixabay', license: 'Pixabay Content License' },
];

// Texto para la regla del AGENTS.md generado.
export const imageSourcesText = () =>
  IMAGE_SOURCES.map((s) => `\`${s.domain}\` (${s.license})`).join(', ');
