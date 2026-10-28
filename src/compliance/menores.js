// Perfil de cumplimiento: contenido/servicios dirigidos a menores
// (COPPA / GDPR art. 8 / Ley 25.326 AR). Se infiere cuando la idea
// menciona niños/kids/escolar — o se fuerza con --compliance menores.
export default {
  id: 'menores',
  label: 'Menores de edad',
  infer: /(niños|niñas|kids|infantil|juguetes?|escolar|colegio|pediatr|menores|adolescent)/,
  overlayDir: 'menores',
  promptBlock: `
- La app es dirigida a menores o puede ser usada por ellos: integrar el componente \`src/components/AgeGate.jsx\` (ya copiado al proyecto) como verificación de edad, envolviendo el contenido restringido. NO recolectar datos personales de menores sin consentimiento parental verificable — declararlo en /privacidad. Evitar trackers/analytics sobre audiencias menores.`,
  requirements: [
    {
      check: 'some',
      type: 'frontend',
      keywords: ['edad'],
      error: 'algún paso frontend debe declarar la verificación de edad (AgeGate) para menores',
      prompt:
        'Algún paso `frontend` debe declarar la verificación de edad (`AgeGate` ya copiado a `src/components/`) para audiencias menores.',
    },
  ],
};
