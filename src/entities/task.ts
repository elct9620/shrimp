import { Priority } from './priority'
import { Section } from './section'

export type Task = {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly priority: Priority
  readonly section: Section
}
