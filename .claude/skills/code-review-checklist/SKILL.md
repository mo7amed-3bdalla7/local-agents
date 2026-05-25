---
name: code-review-checklist
description: Structured checklist for reviewing pull requests — correctness, security, performance, conventions. Use when reviewing code in any language.
version: 0.1.0
---

# Code Review Checklist

A disciplined pass over a diff. Run each section in order; skip a section only if it doesn't apply to the change.

## 1. Correctness

- Does the change do what its description says?
- Are edge cases handled? (empty inputs, single-element collections, very large inputs, concurrent access)
- Are error paths exercised? What happens when an upstream call fails, times out, or returns malformed data?
- Are types narrowed where they need to be? Any `any` / `unknown` that papers over a real shape mismatch?
- Are off-by-one errors avoided in loops, slices, and pagination?

## 2. Security

- Is user input validated at the boundary? (SQL injection, XSS, path traversal, command injection)
- Are secrets kept out of code, logs, and error messages?
- Does authorization happen on every endpoint that needs it — not just authentication?
- Are dependencies pinned? Any new transitive dependencies added?

## 3. Performance

- N+1 queries hidden in a loop?
- Are large payloads paginated or streamed?
- Bundle size impact for frontend changes — new large dependencies?
- Any unnecessary re-renders, re-fetches, or recomputation in hot paths?

## 4. Project conventions

- Does the change follow the project's existing module layout, naming, and export patterns?
- Are there existing utilities being duplicated?
- Is the test style consistent with the rest of the suite (same framework, same fixture patterns)?

## 5. What to leave for follow-up

- Pre-existing problems in untouched code stay out of scope — note them, don't block the PR.
- Style nits a linter catches don't belong in a review comment.
- Consolidate small issues into one comment per file rather than fifteen line comments.

## Output format

End with a one-line verdict: `APPROVED`, `CHANGES REQUESTED`, or `NEEDS DISCUSSION`. Below it, list issues as `path:line — what's wrong + suggested fix`. Below the list, add a short paragraph summarizing the overall posture (what looks good, what's risky).
