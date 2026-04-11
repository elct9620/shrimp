import { comparePriority } from './priority'
import { Task } from './task'

const highestPriority = (tasks: Task[]): Task =>
  tasks.reduce((best, current) => (comparePriority(current.priority, best.priority) < 0 ? current : best))

export const selectTask = (inProgress: Task[], backlog: Task[]): Task | null => {
  if (inProgress.length > 0) return highestPriority(inProgress)
  if (backlog.length > 0) return highestPriority(backlog)
  return null
}
