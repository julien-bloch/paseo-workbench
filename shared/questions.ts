/**
 * Questions an agent asks (Claude's AskUserQuestion and providers that mimic it) arrive as a pending
 * permission of kind "question". Answered the way Paseo's own question card answers: allow with the
 * request's input plus `answers` keyed by each question's header (several choices joined with ", "),
 * or deny with "Dismissed by user". The daemon handles the provider-specific part.
 */
export interface Question { question: string; header: string; options: { label: string; description?: string; preview?: string }[]; multiSelect: boolean; allowOther: boolean }

/** The request's questions, or null when its input is not a question form. */
export function parseQuestions(input: unknown): Question[] | null {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>).questions : undefined;
  if (!Array.isArray(raw) || !raw.length) return null;
  const questions: Question[] = [];
  for (const item of raw) {
    const q = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (typeof q.question !== "string" || typeof q.header !== "string" || !Array.isArray(q.options)) return null;
    const options = (q.options as unknown[]).map((o) => (o && typeof o === "object" ? o : {}) as Record<string, unknown>)
      .filter((o) => typeof o.label === "string")
      .map((o) => ({ label: o.label as string, ...(typeof o.description === "string" ? { description: o.description } : {}), ...(typeof o.preview === "string" ? { preview: o.preview } : {}) }));
    questions.push({ question: q.question, header: q.header, options, multiSelect: q.multiSelect === true, allowOther: q.allowOther === true || q.isOther === true || options.length === 0 });
  }
  return questions;
}

/** Answers keyed by header: a typed answer wins; otherwise the chosen labels, in option order. Null until every question has one. */
export function buildAnswers(questions: readonly Question[], chosen: Readonly<Record<number, readonly number[]>>, typed: Readonly<Record<number, string>>): Record<string, string> | null {
  const answers: Record<string, string> = {};
  for (const [i, q] of questions.entries()) {
    const text = q.allowOther ? (typed[i] ?? "").trim() : "";
    const labels = [...(chosen[i] ?? [])].sort((a, b) => a - b).map((n) => q.options[n]?.label).filter((l): l is string => Boolean(l));
    const answer = text || labels.join(", ");
    if (!answer) return null;
    answers[q.header] = answer;
  }
  return answers;
}

/** The next selection after pressing an option: toggled in a multi-select, otherwise that option alone (or none). */
export function toggleChoice(current: readonly number[], option: number, multiSelect: boolean): number[] {
  if (multiSelect) return current.includes(option) ? current.filter((n) => n !== option) : [...current, option];
  return current.includes(option) ? [] : [option];
}
