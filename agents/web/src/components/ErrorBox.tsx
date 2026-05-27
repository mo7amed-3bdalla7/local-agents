/**
 * Inline error banner used by every list/detail page when a React Query
 * call rejects. Renders Error.message when available, otherwise stringifies.
 */
export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
