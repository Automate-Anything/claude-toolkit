"use client";

/**
 * Ticket comment thread + composer. Renders `detail.comments` and posts new ones
 * through `useAddTicketComment` (the mention textarea + @-autocomplete is the
 * shared comment engine, widened to accept the "ticket" entity). Read-only roles
 * see the thread but no composer.
 */
import * as React from "react";
import { MessageSquare, Send } from "lucide-react";
import { initials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/comments/mention-textarea";
import { CommentBody } from "@/components/comments/comment-body";
import { useAddTicketComment } from "../../hooks";
import type { TicketComment } from "../../types";

/** Short relative time ("just now", "5m ago", …); full date in the title. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CommentItem({ comment }: { comment: TicketComment }) {
  const name = comment.author_name?.trim() || "Unknown";
  return (
    <li id={`comment-${comment.id}`} className="flex scroll-mt-20 gap-3">
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-secondary"
        aria-hidden
      >
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-primary">{name}</span>
          <time
            dateTime={comment.created_at}
            title={new Date(comment.created_at).toLocaleString()}
            className="shrink-0 text-xs text-secondary"
          >
            {timeAgo(comment.created_at)}
          </time>
        </div>
        <CommentBody body={comment.body} className="mt-0.5" />
      </div>
    </li>
  );
}

export function TicketComments({
  ticketId,
  comments,
  canWrite,
}: {
  ticketId: number;
  comments: TicketComment[];
  canWrite: boolean;
}) {
  const addComment = useAddTicketComment(ticketId);
  const [body, setBody] = React.useState("");
  const trimmed = body.trim();

  function submit() {
    if (!trimmed || addComment.isPending) return;
    const text = trimmed;
    setBody(""); // optimistic clear; restored if the post fails
    addComment.mutateAsync(text).catch(() => setBody(text));
  }

  return (
    <div className="flex flex-col">
      {comments.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-muted text-secondary">
            <MessageSquare className="size-5" aria-hidden />
          </span>
          <p className="text-sm text-secondary">
            {canWrite ? "No comments yet. Start the thread." : "No comments yet."}
          </p>
        </div>
      )}

      {canWrite && (
        <div className="mt-4 border-t pt-4">
          <label htmlFor={`ticket-comment-${ticketId}`} className="sr-only">
            Add a comment
          </label>
          <MentionTextarea
            id={`ticket-comment-${ticketId}`}
            value={body}
            onChange={setBody}
            onSubmit={submit}
            entityType="ticket"
            entityId={ticketId}
            rows={3}
            placeholder="Add a comment… type @ to mention someone"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="hidden text-xs text-placeholder sm:block">⌘/Ctrl + Enter to post</span>
            <Button
              size="sm"
              onClick={submit}
              disabled={!trimmed}
              loading={addComment.isPending}
              loadingText="Posting…"
              leftIcon={<Send className="size-4" />}
              className="ml-auto"
            >
              Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
