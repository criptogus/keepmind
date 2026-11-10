const app = document.querySelector('#app')
const state = { me: null, meta: null, section: 'overview', data: null, toast: '', error: '', preview: '' }

const SECTIONS = [
  ['overview', 'Visão', () => true],
  ['policy', 'Política', () => true],
  ['teams', 'Times', () => true],
  ['members', 'Pessoas', role => role === 'owner' || role === 'admin'],
  ['agents', 'Agentes', () => true],
  ['vault', 'Cofre', () => true],
  ['audit', 'Auditoria', role => role === 'owner' || role === 'admin' || role === 'auditor'],
  ['scan', 'Varredura', role => role === 'owner' || role === 'admin' || role === 'auditor']
]

const COPY = {
  bad_login: 'Email ou senha não conferem.',
  rate_limited: 'Muitas tentativas. Espere alguns minutos.',
  forbidden: 'Seu papel não pode fazer isso.',
  shadow_key: 'A chave fica no ambiente da empresa. Chave pessoal não é gravada.',
  above_ceiling: 'A autonomia do time não pode passar do teto da empresa.',
  secret_blocked: 'A nota tem uma credencial e não foi salva.',
  last_owner: 'O último dono continua dono.',
  setup_required: 'Ainda não há dono. Conclua o onboarding na página inicial.',
  bad_user: 'Confira o email, a senha (12 caracteres) e o papel.',
  unauthorized: 'Entre de novo.'
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

async function api(pathname, options = {}) {
  const res = await fetch(pathname, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-keepmind-corp': '1',
      ...(options.headers || {})
    }
  })
  const body = await res.json().catch(() => ({ ok: false, error: 'server_error' }))
  if (res.status === 401 && pathname !== '/api/login') {
    state.me = null
    state.section = 'overview'
    render()
  }
  return { status: res.status, body }
}

function toast(text) {
  state.toast = text
  state.error = ''
}

async function boot() {
  const meta = await api('/api/meta')
  state.meta = meta.body
  const me = await api('/api/session')
  state.me = me.body.user || null
  if (!state.me) {
    window.location.replace('/')
    return
  }
  if (state.me.role !== 'owner' && state.me.role !== 'admin') {
    window.location.replace('/brain/')
    return
  }
  await load()
  render()
}

async function load() {
  if (state.section === 'overview') state.data = (await api('/api/overview')).body
  if (state.section === 'policy') state.data = (await api('/api/policy')).body
  if (state.section === 'teams') state.data = (await api('/api/teams')).body
  if (state.section === 'members') state.data = (await api('/api/members')).body
  if (state.section === 'agents') state.data = (await api('/api/agents')).body
  if (state.section === 'vault') state.data = (await api('/api/files')).body
  if (state.section === 'audit') state.data = (await api('/api/audit')).body
  if (state.section === 'scan') state.data = (await api('/api/scan')).body
}

function render() {
  app.innerHTML = state.me ? shell() : login()
  bind()
}

function login() {
  const sso = state.meta?.oidc ? '<a class="btn ghost" href="/api/oidc/start">Entrar com SSO</a>' : ''
  const setup = state.meta?.setupRequired ? `<p class="err">Ainda não há dono. Abra a <a href="/">página inicial</a> e conclua o onboarding.</p>` : ''
  return `<div class="login"><form class="card" id="login">
    <div class="mark">KeepMind Corp</div>
    <h1>Governança</h1>
    <p class="sub">Política da empresa, pessoas e agentes. O second brain fica em <a href="/brain/">KeepMind</a>.</p>
    ${setup}
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required />
    <label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <p class="err" id="login-error">${esc(state.error)}</p>
    <div class="row"><button class="btn" type="submit">Entrar</button>${sso}</div>
  </form></div>`
}

function shell() {
  const nav = SECTIONS.filter(([, , allow]) => allow(state.me.role)).map(([id, label]) =>
    `<button type="button" data-section="${id}" class="${state.section === id ? 'active' : ''}">${label}</button>`
  ).join('')
  return `<div class="shell">
    <nav>
      <div class="mark">KeepMind Corp</div>
      <p class="sub">${esc(state.me.name)} · ${esc(state.me.role)}</p>
      ${nav}
      <button type="button" id="logout">Sair</button>
    </nav>
    <main>
      <div class="top"><h1>${esc(SECTIONS.find(item => item[0] === state.section)?.[1] || '')}</h1><span class="pill">${esc(state.meta?.version || '')}</span></div>
      <p class="toast">${esc(state.toast)}</p>
      <p class="err">${esc(state.error)}</p>
      ${section()}
    </main>
  </div>`
}

function section() {
  const data = state.data || {}
  if (!data.ok && data.error) return `<p>${esc(COPY[data.error] || 'Sem acesso a esta área.')}</p>`
  if (state.section === 'overview') return overview(data)
  if (state.section === 'policy') return policy(data.policy)
  if (state.section === 'teams') return teams(data)
  if (state.section === 'members') return members(data)
  if (state.section === 'agents') return agents(data)
  if (state.section === 'vault') return vault(data)
  if (state.section === 'audit') return audit(data)
  if (state.section === 'scan') return scan(data)
  return ''
}

function overview(data) {
  const scan = data.scan || {}
  const enabled = (data.agents || []).filter(agent => agent.enabled).length
  return `<p class="sub">Cada pessoa escreve em people/${esc(state.me.id)}/. O que é da empresa fica em shared/.</p>
    <div class="grid">
      <div class="panel"><div class="k">Provedores</div><div class="v">${esc((data.policy?.providers || []).join(', ') || 'nenhum')}</div></div>
      <div class="panel"><div class="k">Teto de autonomia</div><div class="v">${esc(data.policy?.autonomyCeiling || '')}</div></div>
      <div class="panel"><div class="k">Agentes ligados</div><div class="v">${enabled}</div></div>
      <div class="panel"><div class="k">Segredos / PII</div><div class="v">${scan.secretTotal ?? '—'} / ${scan.piiTotal ?? '—'}</div></div>
    </div>
    <div class="panel"><div class="k">BYOK da empresa</div><p>Chaves pessoais não entram. A política exige a chave da organização, no ambiente do servidor.</p></div>`
}

function policy(policy) {
  if (!policy) return ''
  const checks = (state.meta?.providers || []).map(name =>
    `<label><input type="checkbox" name="provider" value="${esc(name)}" ${policy.providers.includes(name) ? 'checked' : ''} ${writer ? '' : 'disabled'}/> ${esc(name)}</label>`
  ).join('')
  const options = (state.meta?.autonomy || []).map(mode =>
    `<option ${policy.autonomyCeiling === mode ? 'selected' : ''}>${esc(mode)}</option>`
  ).join('')
  const writer = state.me.role === 'owner' || state.me.role === 'admin'
  return `<form id="policy" class="panel">
    <p>A retenção fica registrada. Esta versão ainda não apaga o cofre sozinha.</p>
    <div class="checks">${checks}</div>
    <label>Teto de autonomia<select name="autonomyCeiling" ${writer ? '' : 'disabled'}>${options}</select></label>
    <label>Retenção em dias<input name="retentionDays" type="number" min="7" max="3650" value="${esc(policy.retentionDays)}" ${writer ? '' : 'disabled'}/></label>
    <label>Residência<input name="residency" value="${esc(policy.residency)}" ${writer ? '' : 'disabled'}/></label>
    ${writer ? '<button class="btn" type="submit">Salvar política</button>' : ''}
  </form>`
}

function teams(data) {
  const writer = state.me.role === 'owner' || state.me.role === 'admin'
  const lock = writer ? '' : 'disabled'
  const rows = (data.teams || []).map(team => `<tr>
    <td><input data-team="${esc(team.id)}" data-field="name" value="${esc(team.name)}" ${lock}/></td>
    <td>${esc(team.id)}</td>
    <td><select data-team="${esc(team.id)}" data-field="autonomy" ${lock}>${(state.meta?.autonomy || []).map(mode => `<option ${team.autonomy === mode ? 'selected' : ''}>${esc(mode)}</option>`).join('')}</select></td>
  </tr>`).join('')
  return `<p class="sub">Teto atual: ${esc(data.ceiling || '')}.</p>
    <form id="teams"><table><thead><tr><th>Nome</th><th>Id</th><th>Autonomia</th></tr></thead><tbody>${rows}</tbody></table>
    ${writer ? '<p class="row"><button class="btn" type="submit">Salvar times</button></p>' : ''}</form>`
}

function members(data) {
  if (!data.members) return '<p>A lista de pessoas fica com dono e admin.</p>'
  const rows = data.members.map(member => `<tr>
    <td>${esc(member.name)}<div class="sub">${esc(member.email)}</div></td>
    <td><span class="pill">${esc(member.role)}</span></td>
    <td>${esc(member.teamId)}</td>
    <td>${member.disabled ? 'inativa' : 'ativa'}</td>
  </tr>`).join('')
  return `<form id="member" class="panel">
      <div class="row">
        <input name="name" placeholder="Nome" autocomplete="name" required />
        <input name="email" type="email" placeholder="Email" autocomplete="off" required />
        <input name="password" type="password" placeholder="Senha (12+)" autocomplete="new-password" required />
        <select name="role"><option>member</option><option>auditor</option><option>admin</option>${state.me.role === 'owner' ? '<option>owner</option>' : ''}</select>
        <button class="btn" type="submit">Adicionar</button>
      </div>
    </form>
    <table><thead><tr><th>Pessoa</th><th>Papel</th><th>Time</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
}

function agents(data) {
  const rows = (data.agents || []).map(agent => `<tr>
    <td>${esc(agent.name)}</td>
    <td>${esc(agent.teamId)}</td>
    <td><input type="checkbox" data-agent="${esc(agent.id)}" ${agent.enabled ? 'checked' : ''} ${state.me.role === 'member' || state.me.role === 'auditor' ? 'disabled' : ''}/></td>
  </tr>`).join('')
  const writer = state.me.role === 'owner' || state.me.role === 'admin'
  return `<form id="agents"><table><thead><tr><th>Agente</th><th>Time</th><th>Ligado</th></tr></thead><tbody>${rows}</tbody></table>
    ${writer ? '<p><button class="btn" type="submit">Salvar agentes</button></p>' : ''}</form>`
}

function vault(data) {
  const files = data.files || []
  const list = files.map(file => `<button type="button" class="filebtn ${state.previewPath === file.path ? 'active' : ''}" data-file="${esc(file.path)}">${esc(file.path)}${file.encrypted ? ' · cifrado' : ''}</button>`).join('') || '<p>Nenhum arquivo visível.</p>'
  const own = `people/${state.me.id}/nota.md`
  const writer = state.me.role !== 'auditor'
  return `<div class="split">
    <div class="panel">${list}</div>
    <div>
      <pre class="panel" id="preview">${esc(state.preview || 'Escolha um arquivo.')}</pre>
      ${writer ? `<form id="note" class="panel">
        <label>Caminho<input name="path" value="${esc(state.draftPath || own)}"/></label>
        <label>Nota<textarea name="text" placeholder="Markdown"></textarea></label>
        <button class="btn" type="submit">Salvar no cofre</button>
      </form>` : ''}
    </div>
  </div>`
}

function audit(data) {
  if (!data.entries) return '<p>A auditoria fica com dono, admin e auditor.</p>'
  const rows = data.entries.map(entry => `<tr><td>${esc(entry.ts)}</td><td>${esc(entry.actor)}</td><td>${esc(entry.op)}</td><td>${esc(entry.path || entry.email || '')}</td></tr>`).join('')
  return `<table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Onde</th></tr></thead><tbody>${rows}</tbody></table>`
}

function scan(data) {
  const scan = data.scan
  if (!scan) return '<p>A varredura fica com dono, admin e auditor.</p>'
  const secrets = (scan.secrets || []).map(hit => `<tr><td>${esc(hit.path)}</td><td>${esc(hit.line)}</td><td>${esc(hit.label)}</td></tr>`).join('')
  const paths = scan.secrets ? `<table><thead><tr><th>Arquivo</th><th>Linha</th><th>Tipo</th></tr></thead><tbody>${secrets || '<tr><td colspan="3">Nenhum segredo.</td></tr>'}</tbody></table>` : '<p>O auditor vê os totais. O caminho de cada achado fica com dono e admin.</p>'
  return `<div class="grid">
      <div class="panel"><div class="k">Segredos</div><div class="v">${esc(scan.secretTotal)}</div></div>
      <div class="panel"><div class="k">PII</div><div class="v">${esc(scan.piiTotal)}</div></div>
      <div class="panel"><div class="k">Arquivos cifrados</div><div class="v">${esc(scan.encryptedFiles)}</div></div>
    </div>${paths}`
}

function bind() {
  document.querySelector('#login')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) })
    if (!res.body.ok) {
      state.error = COPY[res.body.error] || 'Não foi possível entrar.'
      render()
      return
    }
    window.location.replace('/brain/')
  })
  document.querySelectorAll('[data-section]').forEach(button => {
    button.addEventListener('click', async () => {
      state.section = button.dataset.section
      state.toast = ''
      state.error = ''
      state.preview = ''
      await load()
      render()
    })
  })
  document.querySelector('#logout')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: '{}' })
    state.me = null
    state.section = 'overview'
    render()
  })
  document.querySelector('#policy')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/policy', {
      method: 'PUT',
      body: JSON.stringify({
        providers: form.getAll('provider'),
        autonomyCeiling: form.get('autonomyCeiling'),
        retentionDays: Number(form.get('retentionDays')),
        residency: form.get('residency')
      })
    })
    state.toast = res.body.ok ? 'Política salva.' : (COPY[res.body.error] || 'Não salvou.')
    if (res.body.ok) state.data = { ok: true, policy: res.body.policy }
    render()
  })
  document.querySelector('#teams')?.addEventListener('submit', async event => {
    event.preventDefault()
    const teams = (state.data.teams || []).map(team => ({
      id: team.id,
      name: document.querySelector(`[data-team="${CSS.escape(team.id)}"][data-field="name"]`)?.value || team.name,
      autonomy: document.querySelector(`[data-team="${CSS.escape(team.id)}"][data-field="autonomy"]`)?.value || team.autonomy
    }))
    const res = await api('/api/teams', { method: 'PUT', body: JSON.stringify({ teams }) })
    state.error = res.body.ok ? '' : (COPY[res.body.error] || res.body.message || 'Não salvou.')
    state.toast = res.body.ok ? 'Times salvos.' : ''
    if (res.body.ok) state.data = res.body
    render()
  })
  document.querySelector('#member')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    const res = await api('/api/members', {
      method: 'POST',
      body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password'), role: form.get('role') })
    })
    state.error = res.body.ok ? '' : (COPY[res.body.error] || res.body.message || 'Não adicionou.')
    state.toast = res.body.ok ? 'Pessoa adicionada.' : ''
    if (res.body.ok) await load()
    render()
  })
  document.querySelector('#agents')?.addEventListener('submit', async event => {
    event.preventDefault()
    const agents = (state.data.agents || []).map(agent => ({
      ...agent,
      enabled: !!document.querySelector(`[data-agent="${CSS.escape(agent.id)}"]`)?.checked
    }))
    const res = await api('/api/agents', { method: 'PUT', body: JSON.stringify({ agents }) })
    state.toast = res.body.ok ? 'Agentes salvos.' : (COPY[res.body.error] || 'Não salvou.')
    if (res.body.ok) state.data = res.body
    render()
  })
  document.querySelectorAll('[data-file]').forEach(button => {
    button.addEventListener('click', async () => {
      const res = await api(`/api/files/preview?path=${encodeURIComponent(button.dataset.file)}`)
      state.previewPath = button.dataset.file
      state.preview = res.body.encrypted ? 'Arquivo cifrado em repouso (KMS1). O texto não é aberto aqui.' : (res.body.text || '')
      render()
    })
  })
  document.querySelector('#note')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    state.draftPath = String(form.get('path') || '')
    const res = await api('/api/files', { method: 'POST', body: JSON.stringify({ path: form.get('path'), text: form.get('text') }) })
    state.error = res.body.ok ? '' : (COPY[res.body.error] || res.body.message || 'Não salvou.')
    state.toast = res.body.ok ? 'Nota salva.' : ''
    if (res.body.ok) await load()
    render()
  })
}

void boot()
