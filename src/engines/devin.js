import { existsSync, readFileSync } from 'node:fs';
import { config } from '../config.js';

// Engine Devin — `devin acp` (ACP sobre stdio). Autentica con
// windsurf-api-key leído de credentials.toml (lo escribe Devin
// Desktop / `devin auth login`).
export function loadCredentials(credentialsPath = config.devinCredentialsPath) {
  if (!existsSync(credentialsPath)) {
    throw new Error(
      `No se encontró ${credentialsPath}. Autenticá Devin Desktop o ejecutá \`devin auth login\`.`,
    );
  }
  const toml = readFileSync(credentialsPath, 'utf8');
  const get = (k) => toml.match(new RegExp(`${k}\\s*=\\s*"([^"]+)"`))?.[1];
  const apiKey = get('windsurf_api_key');
  const apiServerUrl = get('api_server_url');
  if (!apiKey || !apiServerUrl) {
    throw new Error(
      `${credentialsPath} no contiene windsurf_api_key/api_server_url. Re-autenticá con \`devin auth login\`.`,
    );
  }
  return { apiKey, apiServerUrl };
}

export default {
  id: 'devin',
  label: 'Devin',
  bin: config.devinBin,
  docsUrl: 'https://devin.ai',
  installHint: 'Devin CLI + `devin auth login` (o Devin Desktop)',
  acpArgs: ['acp'],
  tuiArgs: [],
  defaultMode: config.devinMode,
  defaultModel: config.devinModel,
  // authenticate params, o null si el engine no necesita el call.
  authParams() {
    const { apiKey, apiServerUrl } = loadCredentials();
    return {
      methodId: 'windsurf-api-key',
      _meta: { api_key: apiKey, api_server_url: apiServerUrl },
    };
  },
  // El modo bypass es parte del contrato (sin prompts de permisos):
  // si set_config_option falla es un error real, no un warning.
  strictConfig: true,
};
