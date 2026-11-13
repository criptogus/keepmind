export interface ContinuityAdapter {
  read(path: string): string | null
  write(path: string, content: string): void
  list(dir: string): string[]
  assertEvidencePath(path: string): void
  scopePath(path: string): string
  space(): string
  withLock<T>(path: string, fn: () => T): T
}
export type ContinuityActor = 'human' | 'agent'
export type ContinuityAction = 'list' | 'get' | 'create' | 'update' | 'add_decision' | 'review_decision' | 'add_artifact' | 'add_attempt' | 'record_outcome' | 'add_question' | 'resolve_question' | 'context' | 'check' | 'feedback' | 'metrics' | 'acknowledge_evidence'
export interface EvidenceRef { path: string; digest: string; observedAt: string }
export interface Entry { id: string; createdAt: string }
export interface Decision extends Entry { choice: string; rationale: string; alternatives: string[]; rejectionReason: string; assumptions: string[]; expectedOutcome: string; reviewAt: string; evidence: EvidenceRef[]; status: 'proposed' | 'accepted' | 'rejected' | 'superseded'; reviewReason?: string; reviewedAt?: string; reviews?: Array<{status: string; reason: string; reviewedAt: string}> }
export interface Artifact extends Entry { path: string; label: string; decisionIds: string[]; evidence: EvidenceRef[] }
export interface Attempt extends Entry { approach: string; result: string; reason: string; applicability: string }
export interface Outcome extends Entry { decisionId: string; executionStatus: 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'unknown'; observedResult: string; evidence: EvidenceRef[]; lesson: string; lessonConfirmed: boolean; lessonConfirmedAt: string | null }
export interface Question extends Entry { question: string; reason: string; priority: 'high' | 'medium' | 'low'; status: 'open' | 'resolved'; resolution?: string; resolvedAt?: string }
export interface Feedback extends Entry { interventionId: string; value: 'useful' | 'not_useful' | 'resolved'; updatedAt?: string }
export interface Acknowledgement extends Entry { kind: 'project' | 'decision' | 'artifact' | 'outcome'; itemId: string; path: string; originalDigest: string; digest: string; reason: string }
export interface ContinuityRecord { schemaVersion: 1; id: string; title: string; objective: string; successCriteria: string; nextStep: string; status: 'active' | 'paused' | 'completed' | 'archived'; space: string; revision: number; createdAt: string; updatedAt: string; evidence: EvidenceRef[]; decisions: Decision[]; artifacts: Artifact[]; attempts: Attempt[]; outcomes: Outcome[]; questions: Question[]; feedback: Feedback[]; acknowledgements: Acknowledgement[] }
export interface EvidenceState { kind: string; itemId: string; path: string; originalDigest: string; observedAt: string; status: 'verified' | 'changed' | 'unavailable'; currentDigest: string | null; interventionId: string; viaDecisionId?: string }
export interface Handoff { schemaVersion: 1; projectId: string; revision: number; space: string; title: string; objective: string; successCriteria: string; nextStep: string; acceptedDecisions: Decision[]; proposals: Decision[]; rejectedDecisions: Decision[]; attempts: Attempt[]; assumptions: {accepted: string[]; proposed: string[]; historical: string[]}; artifacts: Artifact[]; projectEvidence: EvidenceRef[]; evidence: EvidenceState[]; impacts: EvidenceState[]; outcomes: Array<Outcome & {evidenceStatus: string}>; openQuestions: Question[]; missingQuestion: {interventionId: string; question: string} | null; fingerprint: string; text: string }
export interface CorruptProject { id: string; error: 'CORRUPT_PROJECT' }
export interface ContextArgs extends Record<string, unknown> { projectId: string; maxBytes?: number }
export class ContinuityService {
  constructor(adapter: ContinuityAdapter)
  dispatch(action: 'get' | 'create' | 'update' | 'add_decision' | 'review_decision' | 'add_artifact' | 'add_attempt' | 'record_outcome' | 'add_question' | 'resolve_question' | 'feedback' | 'acknowledge_evidence', args: Record<string, unknown>, actor?: ContinuityActor): ContinuityRecord
  dispatch(action: 'list', args?: Record<string, unknown>, actor?: ContinuityActor): Array<ContinuityRecord | CorruptProject>
  dispatch(action: 'context', args: ContextArgs, actor?: ContinuityActor): Handoff
  dispatch(action: 'check' | 'metrics', args: Record<string, unknown>, actor?: ContinuityActor): Record<string, unknown>
  dispatch(action: string, args?: Record<string, unknown>, actor?: ContinuityActor): any
}
export function assertNoSymlinkPath(root: string, scopedPath: string): void
export function withProjectLock<T>(absolutePath: string, fn: () => T): T
export const continuityToolActions: Record<string, ContinuityAction>
export const continuityTools: Array<{name: string; description: string; inputSchema: {type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean}}>
