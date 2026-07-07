export type QuestionKind = "BASIC" | "SPECIALIST";

export type Question = {
  id: number;
  text: string;
  category: string;
  mediaPath?: string | null;
  mediaType?: "image" | "video" | string | null;
  correctAnswer: string;
  options?: string[] | null;
  weight: 1 | 2 | 3;
  kind: QuestionKind;
  explanation?: string | null;
};
