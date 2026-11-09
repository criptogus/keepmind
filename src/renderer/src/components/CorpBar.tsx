export default function CorpBar({ org, role, adminUrl }: { org: string; role: string; adminUrl?: string | null }) {
  return (
    <div className="corp-bar" role="status">
      <span><strong>KeepMind Corp</strong> · {org}</span>
      <span className="corp-bar__meta">Your AI Second Brain · role {role}</span>
      {adminUrl ? <a className="corp-bar__link" href={adminUrl}>Organization governance</a> : null}
    </div>
  )
}
