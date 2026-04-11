import type { Comment } from '../../entities/comment'
import type { Section } from '../../entities/section'
import type { Task } from '../../entities/task'

export interface BoardRepository {
  getTasks(section: Section): Promise<Task[]>
  getComments(taskId: string): Promise<Comment[]>
  postComment(taskId: string, text: string): Promise<void>
  moveTask(taskId: string, section: Section): Promise<void>
}
