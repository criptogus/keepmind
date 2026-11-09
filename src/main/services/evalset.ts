// Up to 20 questions the sleep cycle can score. Gold answers come from
// corrections and from search gaps that already found a file.

export interface EvalQuestion {
  id: string
  q: string
  a: string
  source: 'gap' | 'correction'
}

export interface EvalScore {
  day: string
  hit: number
  total: number
}

export interface EvalDoc {
  questions: EvalQuestion[]
  scores: EvalScore[]
}

const MAX_QUESTIONS = 20

export function readEval(raw: string): EvalDoc {
  const text = raw.replace(/\r\n/g, '\n')
  const questions = text.split(/^### e-/m).slice(1).map(part => {
    const id = `e-${part.slice(0, part.indexOf('\n') === -1 ? part.length : part.indexOf('\n')).trim()}`
    const field = (name: string) => part.match(new RegExp(`^- ${name}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() ?? ''
    const source = field('source') === 'gap' ? 'gap' as const : 'correction' as const
    return { id, q: field('q'), a: field('a'), source }
  }).filter(item => item.q && item.a)
  const scores = [...text.matchAll(/^### (20\d{2}-\d{2}-\d{2})\n- acertos:\s*(\d+)\n- total:\s*(\d+)/gm)].map(m => ({
    day: m[1],
    hit: Number(m[2]),
    total: Number(m[3])
  }))
  return { questions: questions.slice(-MAX_QUESTIONS), scores }
}

function render(doc: EvalDoc): string {
  const questions = doc.questions.slice(-MAX_QUESTIONS).map(item => [
    `### ${item.id}`,
    `- source: ${item.source}`,
    `- q: ${item.q.replace(/\s+/g, ' ').trim()}`,
    `- a: ${item.a.replace(/\s+/g, ' ').trim()}`,
    ''
  ].join('\n'))
  const scores = doc.scores.slice(-14).map(s => `### ${s.day}\n- acertos: ${s.hit}\n- total: ${s.total}\n`)
  return [
    '# Avaliação',
    '',
    'Até 20 perguntas. O sono confere se a resposta ainda está na memória ativa.',
    '',
    '## Perguntas',
    '',
    ...questions,
    '## Placares',
    '',
    ...scores
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

export function addEvalQuestion(raw: string, q: string, a: string, source: EvalQuestion['source']): string {
  const question = q.replace(/\s+/g, ' ').trim().slice(0, 240)
  const answer = a.replace(/\s+/g, ' ').trim().slice(0, 400)
  if (question.length < 8 || answer.length < 3) return raw
  const doc = readEval(raw)
  const key = question.toLowerCase()
  if (doc.questions.some(item => item.q.toLowerCase() === key)) return raw || render(doc)
  doc.questions.push({
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    q: question,
    a: answer,
    source
  })
  return render(doc)
}

function words(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []))]
}

export function scoreEval(raw: string, corpus: string, day: string): { raw: string; hit: number; total: number } {
  const doc = readEval(raw)
  const answerable = doc.questions.filter(item => item.a.trim().length >= 3)
  if (!answerable.length) return { raw: raw || render(doc), hit: 0, total: 0 }
  const hay = corpus.toLowerCase()
  let hit = 0
  for (const item of answerable) {
    const keys = words(item.a)
    if (!keys.length) continue
    const found = keys.filter(w => hay.includes(w)).length
    if (found / keys.length >= 0.6) hit++
  }
  doc.scores = doc.scores.filter(s => s.day !== day)
  doc.scores.push({ day, hit, total: answerable.length })
  return { raw: render(doc), hit, total: answerable.length }
}
