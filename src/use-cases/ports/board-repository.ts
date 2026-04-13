import type { Comment } from "../../entities/comment";
import type { Section } from "../../entities/section";
import type { Task } from "../../entities/task";

export class BoardSectionMissingError extends Error {
  constructor(sectionName: string) {
    super(`Board section not found: ${sectionName}`);
    this.name = "BoardSectionMissingError";
  }
}

export interface BoardRepository {
  validateSections(): Promise<void>;
  getTasks(section: Section): Promise<Task[]>;
  getComments(taskId: string): Promise<Comment[]>;
  postComment(taskId: string, text: string): Promise<void>;
  moveTask(taskId: string, section: Section): Promise<void>;
}
