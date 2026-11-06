import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'

// ── Google OAuth (PKCE, loopback redirect) ──
// Requires an OAuth 2.0 "Desktop app" client from Google Cloud Console:
//   client_id + client_secret stored in app config (Settings → Account).
// Flow: open browser → Google consent → redirect to 127.0.0.1:<port>/callback
// → exchange code (with PKCE verifier) → fetch profile via userinfo.

export interface GoogleCreds { clientId: string; clientSecret: string }
export interface GoogleProfile { sub: string; email: string; name?: string; picture?: string }

export function googleAuthUrl(creds: GoogleCreds, redirectUri: string, challenge: string, state: string): string {
  const p = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'online',
    prompt: 'select_account'
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`
}

// Runs the full loopback flow; resolves with the Google profile.
// Rejects on timeout (5min), denial, or missing creds.
export function googleLogin(creds: GoogleCreds | null | undefined): Promise<GoogleProfile> {
  return new Promise((resolve, reject) => {
    if (!creds?.clientId || !creds.clientSecret) {
      reject(new Error('Google sign-in is not configured — add the OAuth client ID/secret in Settings → Account'))
      return
    }
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(16).toString('hex')

    let server: Server | null = null
    const timer = setTimeout(() => {
      server?.close()
      reject(new Error('Google sign-in timed out'))
    }, 5 * 60_000)

    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return }
        const code = url.searchParams.get('code')
        const err = url.searchParams.get('error')
        const st = url.searchParams.get('state')
        if (err || !code || st !== state) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body style="background:#030712;color:#7dd3fc;font-family:monospace;display:grid;place-items:center;height:100vh"><h2>Sign-in cancelled — you can close this tab.</h2></body></html>')
          clearTimeout(timer); server?.close()
          reject(new Error(err ? `Google sign-in failed: ${err}` : 'Missing auth code'))
          return
        }
        const port = (server!.address() as any).port
        const redirectUri = `http://127.0.0.1:${port}/callback`
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
          })
        })
        const tokens = await tokenRes.json()
        if (!tokens.access_token) throw new Error(tokens.error_description ?? 'Token exchange failed')
        const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` }
        }).then(r => r.json())
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body style="background:#030712;color:#a3e635;font-family:monospace;display:grid;place-items:center;height:100vh"><h2>✓ Signed in — return to Second Brain.</h2></body></html>')
        clearTimeout(timer); server?.close()
        resolve({ sub: info.sub, email: info.email, name: info.name, picture: info.picture })
      } catch (e) {
        clearTimeout(timer); server?.close()
        reject(e)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const port = (server!.address() as any).port
      const redirectUri = `http://127.0.0.1:${port}/callback`
      shell.openExternal(googleAuthUrl(creds, redirectUri, challenge, state))
    })
  })
}
