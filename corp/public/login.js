const app = document.querySelector('#app')

const COPY = {
  bad_login: 'Email ou senha não conferem.',
  rate_limited: 'Muitas tentativas. Espere alguns minutos.',
  setup_required: 'Falta o dono inicial. Defina KEEPMIND_CORP_OWNER_EMAIL e KEEPMIND_CORP_OWNER_PASSWORD.'
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

async function api(pathname, options = {}) {
  const res = await fetch(pathname, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-keepmind-corp': '1', ...(options.headers || {}) }
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function boot() {
  const session = await api('/api/session')
  if (session.body?.user) {
    window.location.replace('/brain/')
    return
  }
  const meta = await api('/api/meta')
  render(meta.body, '')
}

function render(meta, error) {
  const sso = meta?.oidc ? '<a class="btn ghost" href="/api/oidc/start">Entrar com SSO</a>' : ''
  const setup = meta?.setupRequired ? `<p class="err">${esc(COPY.setup_required)}</p>` : ''
  app.innerHTML = `<div class="login"><form class="card" id="login">
    <div class="mark">KeepMind Corp</div>
    <h1>Second brain corporativo</h1>
    <p class="sub">O mesmo KeepMind que você conhece — memória, Brain, Skills, Chat — com governança da empresa por cima. Donos e admins também abrem <a href="/admin/">governança</a>.</p>
    ${setup}
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required />
    <label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <p class="err">${esc(error)}</p>
    <div class="row"><button class="btn" type="submit">Entrar no KeepMind</button>${sso}</div>
  </form></div>`
  document.querySelector('#login')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    })
    if (!res.body.ok) {
      render(meta, COPY[res.body.error] || 'Não foi possível entrar.')
      return
    }
    window.location.replace('/brain/')
  })
}

void boot()
