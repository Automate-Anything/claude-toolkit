"use client";

/**
 * Ticketing — client data hooks (TanStack Query).
 *
 * Reads: the board/list share one filtered fetch; the detail page loads the
 * full ticket; labels + assignees are small shared lists. Mutations go through
 * the server actions and invalidate the affected keys; status + assignment are
 * OPTIMISTIC with rollback across every cached list so the board feels instant.
 */
import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSupabase } from "@/lib/supabase/browser";
import { useToast } from "@/components/ui/toast";
import { queryKeys } from "@/lib/query-keys";
import { createDb } from "@/lib/db";
import type { Database } from "@/types/db";
import { getTicketDetail, getTickets, listTicketLabels, type Db } from "./api";
import {
  addTicketCommentAction,
  assignTicketAction,
  createTicketAction,
  setTicketStatusAction,
  updateTicketAction,
  upsertTicketLabelAction,
  watchTicketAction,
  type ActionResult,
} from "./actions";
import type { TicketFilters, TicketListItem, TicketListResult, TicketStatus } from "./types";

export class ActionError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ActionError";
    this.fieldErrors = fieldErrors;
  }
}

function unwrapAction<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new ActionError(result.error, result.fieldErrors);
  return result.data;
}

function useDb(): Db {
  const supabase = useSupabase();
  return React.useMemo(() => supabase as unknown as SupabaseClient<Database>, [supabase]);
}

function useToastError(title: string) {
  const { toast } = useToast();
  return (error: unknown) =>
    toast({
      title,
      description: error instanceof Error ? error.message : "Something went wrong.",
      tone: "danger",
    });
}

// ── Reads ────────────────────────────────────────────────────────────
export function useTickets(filters: TicketFilters) {
  const db = useDb();
  return useQuery({
    queryKey: queryKeys.tickets.list(filters),
    queryFn: () => getTickets(db, filters),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useTicketDetail(id: number) {
  const db = useDb();
  return useQuery({
    queryKey: queryKeys.tickets.detail(id),
    queryFn: () => getTicketDetail(db, id),
    enabled: id > 0,
  });
}

export function useTicketLabels() {
  const db = useDb();
  return useQuery({
    queryKey: queryKeys.tickets.labels(),
    queryFn: () => listTicketLabels(db),
    staleTime: 300_000,
  });
}

/** Active-login people for the assignee picker (all logins; RPC ignores the id). */
export function useTicketAssignees() {
  const db = useDb();
  return useQuery({
    queryKey: queryKeys.tickets.options("assignees"),
    queryFn: () => createDb(db).listMentionableProfiles("ticket", 0),
    staleTime: 300_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────
function useInvalidate() {
  const qc = useQueryClient();
  return (id?: number) => {
    qc.invalidateQueries({ queryKey: queryKeys.tickets.lists() });
    if (id != null) qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(id) });
  };
}

export function useCreateTicket() {
  const invalidate = useInvalidate();
  const onError = useToastError("Couldn't create the ticket");
  return useMutation({
    mutationFn: (input: unknown) => createTicketAction(input).then(unwrapAction),
    onSuccess: (created) => invalidate(created.id),
    onError,
  });
}

export function useUpdateTicket(id: number) {
  const invalidate = useInvalidate();
  const onError = useToastError("Couldn't save the ticket");
  return useMutation({
    mutationFn: (input: unknown) => updateTicketAction(id, input).then(unwrapAction),
    onSuccess: () => invalidate(id),
    onError,
  });
}

/** Optimistic status change across every cached list (board drag feels instant). */
export function useSetTicketStatus() {
  const qc = useQueryClient();
  const onError = useToastError("Couldn't change the status");
  return useMutation({
    mutationFn: (vars: { id: number; status: TicketStatus; note?: string }) =>
      setTicketStatusAction(vars.id, { status: vars.status, note: vars.note }).then(unwrapAction),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: queryKeys.tickets.lists() });
      const prev = qc.getQueriesData<TicketListResult>({ queryKey: queryKeys.tickets.lists() });
      qc.setQueriesData<TicketListResult>({ queryKey: queryKeys.tickets.lists() }, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it: TicketListItem) =>
                it.id === vars.id ? { ...it, status: vars.status } : it,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (error, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
      onError(error);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.tickets.lists() });
      qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(vars.id) });
    },
  });
}

/** Optimistic assignment across every cached list. */
export function useAssignTicket() {
  const qc = useQueryClient();
  const onError = useToastError("Couldn't assign the ticket");
  return useMutation({
    mutationFn: (vars: { id: number; assigneeId: string | null; assigneeName?: string | null }) =>
      assignTicketAction(vars.id, { assignee_id: vars.assigneeId }).then(unwrapAction),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: queryKeys.tickets.lists() });
      const prev = qc.getQueriesData<TicketListResult>({ queryKey: queryKeys.tickets.lists() });
      qc.setQueriesData<TicketListResult>({ queryKey: queryKeys.tickets.lists() }, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it: TicketListItem) =>
                it.id === vars.id
                  ? { ...it, assignee_id: vars.assigneeId, assignee_name: vars.assigneeName ?? null }
                  : it,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (error, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
      onError(error);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.tickets.lists() });
      qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(vars.id) });
    },
  });
}

export function useAddTicketComment(id: number) {
  const qc = useQueryClient();
  const onError = useToastError("Couldn't post the comment");
  return useMutation({
    mutationFn: (body: string) => addTicketCommentAction(id, { body }).then(unwrapAction),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(id) }),
    onError,
  });
}

export function useUpsertTicketLabel() {
  const qc = useQueryClient();
  const onError = useToastError("Couldn't save the label");
  return useMutation({
    mutationFn: (input: unknown) => upsertTicketLabelAction(input).then(unwrapAction),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tickets.labels() }),
    onError,
  });
}

export function useWatchTicket(id: number) {
  const qc = useQueryClient();
  const onError = useToastError("Couldn't update your watch setting");
  return useMutation({
    mutationFn: (watch: boolean) => watchTicketAction(id, watch).then(unwrapAction),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(id) }),
    onError,
  });
}
