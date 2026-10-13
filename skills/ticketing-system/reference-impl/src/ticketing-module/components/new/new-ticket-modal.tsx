"use client";

/**
 * Create-ticket dialog. Title is the only hard requirement; everything else is
 * optional and defaulted server-side. Labels can be picked from the shared
 * library or created inline. On success we route to the new ticket's detail page
 * (attachments are added there — the create form stays light).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { labelColorClass, labelColorName, LABEL_COLORS, type LabelColor } from "../../labels";
import { TICKET_LINKED_TYPES, TICKET_PRIORITIES, TICKET_TYPES } from "../../schema";
import { priorityLabel } from "../../priority";
import { ActionError, useCreateTicket, useTicketAssignees, useTicketLabels } from "../../hooks";
import { useUpsertTicketLabel } from "../../hooks";
import type { TicketLinkedType } from "../../types";
import { ticketTypeLabel } from "../cells";

const LINKED_LABEL: Record<TicketLinkedType, string> = {
  project: "Project",
  proposal: "Proposal",
  customer: "Customer",
  document: "Document",
};

export function NewTicketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const create = useCreateTicket();
  const { data: labels = [] } = useTicketLabels();
  const { data: assignees = [] } = useTicketAssignees();
  const upsertLabel = useUpsertTicketLabel();

  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [type, setType] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [linkedType, setLinkedType] = React.useState("");
  const [linkedId, setLinkedId] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [labelIds, setLabelIds] = React.useState<number[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Inline label creation.
  const [newLabel, setNewLabel] = React.useState("");
  const [newColor, setNewColor] = React.useState<LabelColor>("emerald");

  // Reset when the dialog is (re)opened.
  React.useEffect(() => {
    if (!open) return;
    setTitle("");
    setBody("");
    setType("");
    setPriority("");
    setAssigneeId("");
    setLinkedType("");
    setLinkedId("");
    setDueDate("");
    setLabelIds([]);
    setErrors({});
    setNewLabel("");
    setNewColor("emerald");
  }, [open]);

  function toggleLabel(id: number) {
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function addLabel() {
    const name = newLabel.trim();
    if (!name || upsertLabel.isPending) return;
    try {
      const created = await upsertLabel.mutateAsync({ name, color: newColor });
      setLabelIds((prev) => [...prev, created.id]);
      setNewLabel("");
    } catch {
      /* hook already toasts */
    }
  }

  async function submit() {
    setErrors({});
    const input: Record<string, unknown> = { title: title.trim() };
    if (body.trim()) input.body = body.trim();
    if (type) input.type = type;
    if (priority) input.priority = priority;
    if (assigneeId) input.assignee_id = assigneeId;
    if (linkedType) input.linked_entity_type = linkedType;
    if (linkedType && linkedId.trim()) input.linked_entity_id = Number(linkedId.trim());
    if (dueDate) input.due_date = dueDate;
    if (labelIds.length > 0) input.label_ids = labelIds;

    try {
      const created = await create.mutateAsync(input);
      toast({ title: "Ticket created", description: created.number, tone: "success" });
      onClose();
      router.push(`/tickets/${created.id}`);
    } catch (error) {
      if (error instanceof ActionError && error.fieldErrors) {
        setErrors(error.fieldErrors);
      }
      // Non-field errors are toasted by the hook.
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New ticket"
      description="File a bug, request, or question for the team."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={create.isPending}
            loadingText="Creating…"
            disabled={!title.trim()}
            leftIcon={<Plus className="size-4" aria-hidden />}
          >
            Create ticket
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Title" htmlFor="ticket-title" error={errors.title}>
          <Input
            id="ticket-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary of the issue"
            autoFocus
            required
          />
        </Field>

        <Field label="Description" htmlFor="ticket-body" error={errors.body}>
          <Textarea
            id="ticket-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Steps to reproduce, what you expected, links… (Markdown supported)"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="ticket-type">
            <Select id="ticket-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Default (question)</option>
              {TICKET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ticketTypeLabel(t)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="ticket-priority">
            <Select
              id="ticket-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="">Default (medium)</option>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Assignee" htmlFor="ticket-assignee">
            <Select
              id="ticket-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.profile_id} value={a.profile_id}>
                  {a.full_name || a.email || "Unnamed"}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Due date" htmlFor="ticket-due" error={errors.due_date}>
            <Input
              id="ticket-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
        </div>

        {/* Optional link to one of the app's own records. */}
        <fieldset className="rounded-lg border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.06em] text-secondary">
            Linked record (optional)
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Record type" htmlFor="ticket-linked-type">
              <Select
                id="ticket-linked-type"
                value={linkedType}
                onChange={(e) => setLinkedType(e.target.value)}
              >
                <option value="">None</option>
                {TICKET_LINKED_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LINKED_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Record ID"
              htmlFor="ticket-linked-id"
              error={errors.linked_entity_id}
              hint={linkedType ? "The record's numeric ID" : undefined}
            >
              <Input
                id="ticket-linked-id"
                type="number"
                inputMode="numeric"
                min={1}
                value={linkedId}
                onChange={(e) => setLinkedId(e.target.value)}
                disabled={!linkedType}
                placeholder="e.g. 123"
              />
            </Field>
          </div>
        </fieldset>

        {/* Labels: pick from the library or create inline. */}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-primary">Labels</span>
          {labels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label) => {
                const active = labelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleLabel(label.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-shadow duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                      labelColorClass(label.color),
                      active
                        ? "ring-2 ring-[color:var(--border-focus)] ring-offset-1 ring-offset-[color:var(--bg-elevated)]"
                        : "opacity-80 hover:opacity-100",
                    )}
                  >
                    {active ? <Check className="size-3" aria-hidden /> : <Tag className="size-3" aria-hidden />}
                    {label.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-secondary">No labels yet — create the first one below.</p>
          )}

          <div className="mt-2.5 flex flex-wrap items-end gap-2">
            <div className="min-w-[8rem] flex-1">
              <label htmlFor="new-label-name" className="sr-only">
                New label name
              </label>
              <Input
                id="new-label-name"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="New label…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addLabel();
                  }
                }}
              />
            </div>
            <label htmlFor="new-label-color" className="sr-only">
              New label color
            </label>
            <Select
              id="new-label-color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value as LabelColor)}
              className="w-auto"
            >
              {LABEL_COLORS.map((c) => (
                <option key={c} value={c}>
                  {labelColorName(c)}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              onClick={addLabel}
              loading={upsertLabel.isPending}
              disabled={!newLabel.trim()}
              leftIcon={<Plus className="size-4" aria-hidden />}
            >
              Add
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
