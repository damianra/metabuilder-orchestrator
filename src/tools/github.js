const API = 'https://api.github.com';

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message ?? `GitHub API ${res.status}`);
    err.status = res.status;
    err.errors = data.errors;
    throw err;
  }
  return data;
}

export const getGitHubUser = (token) => api(token, 'GET', '/user');

export const createRepo = (token, name, description) =>
  api(token, 'POST', '/user/repos', { name, private: false, description, auto_init: false });

export const enablePages = (token, owner, repo) =>
  api(token, 'POST', `/repos/${owner}/${repo}/pages`, {
    source: { branch: 'gh-pages', path: '/' },
  });

// Flujo de trabajo del repo orquestador: branch → PR → validación.
export const createPullRequest = (token, owner, repo, { head, base = 'main', title, body = '' }) =>
  api(token, 'POST', `/repos/${owner}/${repo}/pulls`, { head, base, title, body });

export const commentOnPR = (token, owner, repo, prNumber, body) =>
  api(token, 'POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, { body });
