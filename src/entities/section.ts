export const Section = {
  Backlog: 'Backlog',
  InProgress: 'In Progress',
  Done: 'Done',
} as const

export type Section = (typeof Section)[keyof typeof Section]
