export const COMMENT_TAG = "[Shrimp] ";

export type CommentAuthor = "bot" | "user";

export type Comment = {
  readonly text: string;
  readonly timestamp: Date;
  readonly author: CommentAuthor;
};

export function isTagged(text: string): boolean {
  return text.startsWith(COMMENT_TAG);
}

export function stripTag(text: string): string {
  return text.slice(COMMENT_TAG.length);
}
