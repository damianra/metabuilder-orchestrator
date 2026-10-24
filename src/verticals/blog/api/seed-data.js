// Seed del vertical "blog". El paso backend (generativo-lite)
// personaliza estos datos según la idea del usuario: temática del
// blog, títulos/cuerpos de posts reales del tema, categorías y tags
// coherentes, comentarios de ejemplo aprobados.
// Las keys son tablas reales — db.js hace INSERT directo. Los ids son
// explícitos para poder referenciar post_id/tag_id en las relaciones
// (el seed solo corre con las tablas vacías → ids determinísticos).
export const seedData = {
  categories: [
    { id: 1, name: 'Tecnología', slug: 'tecnologia' },
    { id: 2, name: 'Tutoriales', slug: 'tutoriales' },
    { id: 3, name: 'Noticias', slug: 'noticias' },
  ],
  posts: [
    {
      id: 1,
      slug: 'bienvenidos-al-blog',
      title: 'Bienvenidos al blog',
      excerpt: 'Primer post de presentación.',
      body: 'Contenido de ejemplo — el paso backend lo reemplaza con posts reales de la temática de la idea.',
      cover_image: null,
      status: 'published',
      category_id: 3,
    },
    {
      id: 2,
      slug: 'como-funciona-este-blog',
      title: 'Cómo funciona este blog',
      excerpt: 'Posts con categorías, tags y comentarios.',
      body: 'Cada post pertenece a una categoría y puede tener varios tags. Los lectores comentan y los comentarios quedan pendientes de moderación.',
      cover_image: null,
      status: 'published',
      category_id: 2,
    },
  ],
  tags: [
    { id: 1, name: 'general' },
    { id: 2, name: 'meta' },
  ],
  post_tags: [
    { post_id: 1, tag_id: 1 },
    { post_id: 2, tag_id: 1 },
    { post_id: 2, tag_id: 2 },
  ],
  comments: [
    { post_id: 1, author: 'Lector', body: '¡Felicitaciones por el lanzamiento!', status: 'approved' },
  ],
};
