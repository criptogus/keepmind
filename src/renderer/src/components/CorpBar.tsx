export default function CorpBar({ org, role, adminUrl }: { org: string; role: string; adminUrl?: string | null }) {
  return (
    <div className="corp-bar" role="status">
      <span><strong>KeepMind Corp</strong> · {org}</span>
      <span className="corp-bar__meta">Seu second brain · papel {role}</span>
      {adminUrl ? <a className="corp-bar__link" href={adminUrl}>Governança da organização</a> : null}
    </div>
  )
}
