import { config } from '../config.js';

// Engine OpenCode — `opencode acp` (ACP v1, verificado contra v2.1.4:
// mismo JSON-RPC que Devin, session/new devuelve configOptions
// mode=build|plan y model=provider/model).
// Sin authenticate: usa los providers de `opencode auth login`. Si un
// prompt necesita auth devuelve `auth_required` — se mapea a authHint.
export default {
  id: 'opencode',
  label: 'OpenCode',
  bin: config.opencodeBin,
  acpArgs: ['acp'],
  tuiArgs: [],
  defaultMode: 'build',
  defaultModel: config.opencodeModel || null, // null → default del provider
  authParams: null,
  authHint: 'ejecutá `opencode auth login` para configurar un provider',
  // build ya es el default y el model viene del provider: si
  // set_config_option falla se sigue con los defaults, no se aborta.
  strictConfig: false,
};
