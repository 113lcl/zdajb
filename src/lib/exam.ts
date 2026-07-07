import type { Question } from "../types/domain";

export const passScore = 68;
export const maxScore = 74;

export function secondsForQuestion(question: Question) {
  return question.kind === "BASIC" ? 35 : 50;
}

export function isCorrectAnswer(question: Question, selected: string) {
  return selected.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
}
