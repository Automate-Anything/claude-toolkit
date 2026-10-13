"use client";

/**
 * Ticket attachments. Files live in the private `tickets` Storage bucket and are
 * recorded in the generic `attachments` table (entity_type = 'ticket') — the same
 * bucket/table/RLS pattern the task workspace uses. Upload writes the object then
 * the row (rolling the object back if the row insert fails); images/video preview
 * inline (via a signed URL), everything else is a download chip. Read-only roles
 * see the list but get no upload/delete controls.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSupabase } from "@/lib/supabase/browser";
import { useToast } from "@/components/ui/toast";
import { queryKeys } from "@/lib/query-keys";
import type { Database } from "@/types/db";
import { MAX_UPLOAD_BYTES, formatBytes, validateUpload } from "@/modules/uploads/limits";
import type { TicketAttachment } from "../../types";

const BUCKET = "tickets";

function isImage(a: TicketAttachment): boolean {
  return (a.content_type ?? "").startsWith("image/");
}
function isVideo(a: TicketAttachment): boolean {
  return (a.content_type ?? "").startsWith("video/");
}

export function TicketAttachments({
  ticketId,
  attachments,
  canWrite,
}: {
  ticketId: number;
  attachments: TicketAttachment[];
  canWrite: boolean;
}) {
  const supabase = useSupabase();
  const sb = React.useMemo(() => supabase as unknown as SupabaseClient<Database>, [supabase]);
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [urls, setUrls] = React.useState<Record<number, string>>({});

  function refresh() {
    qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(ticketId) });
  }

  // Resolve signed URLs for previewable (image/video) attachments.
  const previewKey = attachments
    .filter((a) => isImage(a) || isVideo(a))
    .map((a) => `${a.id}:${a.file_path}`)
    .join(",");
  React.useEffect(() => {
    let cancelled = false;
    const previewable = attachments.filter((a) => isImage(a) || isVideo(a));
    if (previewable.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        previewable.map(async (a) => {
          const { data } = await sb.storage.from(BUCKET).createSignedUrl(a.file_path, 3600);
          return [a.id, data?.signedUrl] as const;
        }),
      );
      if (cancelled) return;
      setUrls((prev) => {
        const next = { ...prev };
        for (const [id, url] of entries) if (url) next[id] = url;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, sb]);

  async function handleFile(file: File) {
    const check = validateUpload(file.name, file.size, MAX_UPLOAD_BYTES);
    if (!check.ok) {
      toast({ title: "Can't attach that file", description: check.reason, tone: "danger" });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const { data: userData } = await sb.auth.getUser();
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const key = `tickets/${ticketId}/${Date.now()}-${safe}`;
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(key, file, { upsert: false, contentType: file.type || undefined });
      if (upErr) throw new Error(upErr.message);
      const { error: rowErr } = await sb.from("attachments").insert({
        entity_type: "ticket",
        entity_id: ticketId,
        file_path: key,
        file_name: file.name,
        content_type: file.type || null,
        byte_size: file.size,
        uploaded_by: userData.user?.id ?? null,
      });
      if (rowErr) {
        await sb.storage
          .from(BUCKET)
          .remove([key])
          .catch(() => {});
        throw new Error(rowErr.message);
      }
      refresh();
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download(attachment: TicketAttachment) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(attachment.file_path, 60);
    if (error || !data) {
      toast({ title: "Couldn't open the file", tone: "danger" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function remove(attachment: TicketAttachment) {
    setBusy(true);
    try {
      const { error } = await sb.from("attachments").delete().eq("id", attachment.id);
      if (error) throw new Error(error.message);
      await sb.storage
        .from(BUCKET)
        .remove([attachment.file_path])
        .catch(() => {});
      refresh();
    } catch (error) {
      toast({
        title: "Couldn't remove the file",
        description: error instanceof Error ? error.message : "Please try again.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {attachments.length > 0 ? (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {attachments.map((attachment) => {
            const url = urls[attachment.id];
            const size = formatBytes(attachment.byte_size);
            return (
              <li
                key={attachment.id}
                className="flex flex-col overflow-hidden rounded-lg border bg-surface"
              >
                {isImage(attachment) && url ? (
                  <button
                    type="button"
                    onClick={() => download(attachment)}
                    className="block bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                    aria-label={`Open ${attachment.file_name ?? "image"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={attachment.file_name ?? "Attached image"}
                      className="max-h-48 w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ) : isVideo(attachment) && url ? (
                  <video src={url} controls className="max-h-48 w-full bg-black" preload="metadata" />
                ) : null}

                <div className="flex items-center gap-2 px-3 py-2">
                  <FileText className="size-4 shrink-0 text-secondary" aria-hidden />
                  <button
                    type="button"
                    onClick={() => download(attachment)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left text-sm text-primary transition-colors duration-fast ease-out hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <span className="truncate">{attachment.file_name ?? "Attachment"}</span>
                    <Download className="size-3.5 shrink-0 text-secondary" aria-hidden />
                  </button>
                  {size && <span className="shrink-0 text-xs text-placeholder">{size}</span>}
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => remove(attachment)}
                      disabled={busy}
                      aria-label={`Remove ${attachment.file_name ?? "attachment"}`}
                      className="grid size-8 shrink-0 place-items-center rounded-md text-secondary transition-colors duration-fast ease-out hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 [@media(pointer:coarse)]:size-11"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed bg-surface px-3 py-4 text-center text-sm text-placeholder">
          <Paperclip className="mx-auto mb-1 size-4" aria-hidden />
          No attachments{canWrite ? " yet" : ""}.
        </p>
      )}

      {canWrite && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm font-medium text-secondary transition-colors duration-fast ease-out hover:border-strong hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 [@media(pointer:coarse)]:min-h-[44px]"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          Attach file
        </button>
      )}
    </div>
  );
}
