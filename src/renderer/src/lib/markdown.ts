// Minimal markdown → HTML for previews (escaped first, no raw HTML).
export function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc(md)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- \[ \] (.*)$/gm, '<div class="md-todo">☐ $1</div>')
    .replace(/^- \[x\] (.*)$/gm, '<div class="md-todo md-todo--done">☑ $1</div>')
    .replace(/^- (.*)$/gm, '<div class="md-li">• $1</div>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>')
    .replace(/<p><\/(h[123]|div)>/g, '</$1>')
    .replace(/<\/(h[123]|div)><p>/g, '</$1><p>')
}
