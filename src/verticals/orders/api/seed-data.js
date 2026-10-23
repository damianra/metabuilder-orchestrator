// Seed del vertical "orders". El paso backend (generativo-lite)
// personaliza estos datos según la idea del usuario: nombre/tagline/
// whatsapp del local en business y productos reales del rubro.
// icons: nombres lucide en kebab-case.
export const seedData = {
  business: [
    {
      id: 1,
      name: 'Casa de Comidas',
      tagline: 'Comida casera, todos los días',
      address: '',
      hours: '',
      whatsapp: '',
    },
  ],
  categories: [
    { name: 'Entradas', sort_order: 1 },
    { name: 'Principales', sort_order: 2 },
    { name: 'Postres', sort_order: 3 },
    { name: 'Bebidas', sort_order: 4 },
  ],
  products: [
    { name: 'Empanadas (docena)', description: 'Carne, pollo o jamón y queso', price: 9500, category_id: 1, icon: 'circle-dot' },
    { name: 'Provoleta', description: 'Con tomate y orégano', price: 7200, category_id: 1, icon: 'flame' },
    { name: 'Milanesa con papas', description: 'De carne o pollo, con papas fritas', price: 12000, category_id: 2, icon: 'beef' },
    { name: 'Pizza muzzarella', description: 'Grande, 8 porciones', price: 11000, category_id: 2, icon: 'pizza' },
    { name: 'Ensalada completa', description: 'Lechuga, tomate, huevo y zanahoria', price: 8000, category_id: 2, icon: 'salad' },
    { name: 'Flan casero', description: 'Con dulce de leche o crema', price: 4500, category_id: 3, icon: 'cake-slice' },
    { name: 'Helado (1/4 kg)', description: 'Hasta 3 gustos', price: 6500, category_id: 3, icon: 'ice-cream-cone' },
    { name: 'Gaseosa 1.5L', description: 'Línea Coca-Cola o Sprite', price: 3800, category_id: 4, icon: 'cup-soda' },
  ],
};
