const app = document.querySelector('#app')

const COPY = {
  bad_login: 'Email ou senha não conferem.',
  rate_limited: 'Muitas tentativas. Espere alguns minutos.',
  weak_password: 'Use uma senha com pelo menos 12 caracteres.',
  mismatch: 'As senhas não conferem.',
  bad_email: 'Email inválido.',
  setup_done: 'O dono já foi criado — use o login.'
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

let wizardStep = 0
let wizardMeta = null
let wizardForm = {
  orgName: '',
  name: '',
  email: '',
  password: '',
  confirm: ''
}

async function boot() {
  const session = await api('/api/session')
  if (session.body?.user) {
    window.location.replace('/brain/')
    return
  }
  const meta = await api('/api/meta')
  wizardMeta = meta.body
  if (meta.body?.setupRequired) renderWizard('')
  else renderLogin(meta.body, '')
}

function stepDots(n, total = 4) {
  let html = '<div class="ob-steps">'
  for (let i = 0; i < total; i++) html += `<span class="${i <= n ? 'on' : ''}"></span>`
  return html + '</div>'
}

function renderWizard(error) {
  const sso = wizardMeta?.oidc ? '<p class="sub">Sua empresa pode usar <a href="/api/oidc/start">SSO</a> depois da conta de dono existir.</p>' : ''
  let inner = ''
  if (wizardStep === 0) {
    inner = `${stepDots(0)}
    <h1>O que é o KeepMind Corp?</h1>
    <p class="sub">É o <strong>KeepMind</strong> (memória, Brain, Skills, Chat) rodando com governança da empresa — não é só um cofre.</p>
    <div class="ob-illus">
      <strong>Você ganha</strong>
      <ul>
        <li><strong>/brain/</strong> — seu second brain, igual ao app desktop, com limites da org.</li>
        <li><strong>/admin/</strong> — times, política de IA, agentes e auditoria (dono/admin).</li>
        <li><strong>Partição por pessoa</strong> — sua memória fica em <code>people/&lt;você&gt;/</code> + pastas compartilhadas.</li>
      </ul>
    </div>
    <div class="ob-actions"><button type="button" class="btn" id="next">Começar configuração</button></div>`
  } else if (wizardStep === 1) {
    inner = `${stepDots(1)}
    <h1>Sua empresa no Corp</h1>
    <p class="sub">Nome que aparece para todo mundo na barra superior e nos relatórios.</p>
    <label for="orgName">Nome da organização</label>
    <input id="orgName" name="orgName" value="${esc(wizardForm.orgName)}" placeholder="Ex.: Acme Brasil" required />
    <div class="ob-actions">
      <button type="button" class="btn ghost" id="back">Voltar</button>
      <button type="button" class="btn" id="next">Continuar</button>
    </div>`
  } else if (wizardStep === 2) {
    inner = `${stepDots(2)}
    <h1>Conta de dono (owner)</h1>
    <p class="sub">Quem cria a org hoje vira <strong>owner</strong>: pode convidar pessoas e mudar política. Depois você adiciona admins.</p>
    <label for="name">Seu nome</label>
    <input id="name" name="name" value="${esc(wizardForm.name)}" autocomplete="name" required />
    <label for="email">Email de trabalho</label>
    <input id="email" name="email" type="email" value="${esc(wizardForm.email)}" autocomplete="username" required />
    <div class="ob-actions">
      <button type="button" class="btn ghost" id="back">Voltar</button>
      <button type="button" class="btn" id="next">Continuar</button>
    </div>`
  } else {
    inner = `${stepDots(3)}
    <h1>Proteja a conta</h1>
    <p class="sub">Mínimo de 12 caracteres. Guarde em um gerenciador de senhas.</p>
    <label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required />
    <label for="confirm">Confirmar senha</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password" required />
    <p class="err">${esc(error)}</p>
    <div class="ob-actions">
      <button type="button" class="btn ghost" id="back">Voltar</button>
      <button type="button" class="btn" id="finish">Criar organização e entrar</button>
    </div>
    ${sso}`
  }

  app.innerHTML = `<div class="ob-wrap"><form class="card ob-card" id="wizard">
    <div class="mark">KeepMind Corp</div>
    ${inner}
  </form></div>`

  document.querySelector('#back')?.addEventListener('click', () => {
    syncWizardFields()
    wizardStep = Math.max(0, wizardStep - 1)
    renderWizard('')
  })
  document.querySelector('#next')?.addEventListener('click', () => {
    syncWizardFields()
    if (wizardStep === 1 && !wizardForm.orgName.trim()) {
      renderWizard('Informe o nome da organização.')
      return
    }
    if (wizardStep === 2) {
      if (!wizardForm.name.trim()) return renderWizard('Informe seu nome.')
      if (!wizardForm.email.includes('@')) return renderWizard('Email inválido.')
    }
    wizardStep = Math.min(3, wizardStep + 1)
    renderWizard('')
  })
  document.querySelector('#finish')?.addEventListener('click', async () => {
    syncWizardFields()
    const res = await api('/api/setup', {
      method: 'POST',
      body: JSON.stringify(wizardForm)
    })
    if (!res.body.ok) {
      const msg = res.body.message || COPY[res.body.error] || 'Não foi possível concluir o setup.'
      renderWizard(msg)
      return
    }
    window.location.replace('/brain/')
  })
}

function syncWizardFields() {
  const org = document.querySelector('#orgName')
  const name = document.querySelector('#name')
  const email = document.querySelector('#email')
  const password = document.querySelector('#password')
  const confirm = document.querySelector('#confirm')
  if (org) wizardForm.orgName = org.value
  if (name) wizardForm.name = name.value
  if (email) wizardForm.email = email.value
  if (password) wizardForm.password = password.value
  if (confirm) wizardForm.confirm = confirm.value
}

function renderLogin(meta, error) {
  const sso = meta?.oidc ? '<a class="btn ghost" href="/api/oidc/start">Entrar com SSO</a>' : ''
  app.innerHTML = `<div class="login"><form class="card" id="login">
    <div class="mark">KeepMind Corp</div>
    <h1>Entrar no second brain</h1>
    <p class="sub">Memória, Brain, Skills e Chat com política da empresa. Donos e admins: <a href="/admin/">governança</a>.</p>
    <details class="ob-illus" style="cursor:pointer">
      <summary>O que é isso?</summary>
      <p>O Corp é o KeepMind em modo organização: cada pessoa tem vault próprio, há pasta compartilhada e um painel para IA permitida, times e auditoria.</p>
    </details>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required />
    <label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <p class="err">${esc(error)}</p>
    <div class="row"><button class="btn" type="submit">Entrar</button>${sso}</div>
  </form></div>`
  document.querySelector('#login')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    })
    if (!res.body.ok) {
      renderLogin(meta, COPY[res.body.error] || 'Não foi possível entrar.')
      return
    }
    window.location.replace('/brain/')
  })
}

void boot()
