export const Priority = {
  p1: 1,
  p2: 2,
  p3: 3,
  p4: 4,
} as const;

export type Priority = (typeof Priority)[keyof typeof Priority];

export const comparePriority = (a: Priority, b: Priority): number => a - b;
