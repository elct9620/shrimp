import { Section } from "../../../entities/section";

export type SectionInput = "Backlog" | "InProgress" | "Done";

export const sectionMap: Record<SectionInput, Section> = {
  Backlog: Section.Backlog,
  InProgress: Section.InProgress,
  Done: Section.Done,
} as const;
