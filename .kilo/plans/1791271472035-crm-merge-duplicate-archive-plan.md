# CRM Updates: Sort Dropdown, Merge Permissions, and Archive-on-Merge

## Overview

Three related changes to the Rwaq CRM clients/merge workflow:
1. Make the "Sort By" dropdown a visual-only indicator (no reorder/refetch).
2. Role-based access for the Merge/duplicates feature — standard users see the button but cannot execute merges.
3. Merge source records are archived (not deleted) and explicitly flagged "Archived" in the survivor's activity log.

---

## Context from codebase analysis

### Sort By flow
- **Dropdown**: `src/components/ClientFilterBar.tsx` lines 117–129 renders a `Select` with `onChange={v => setSortBy!(v as SortField)}`.
- **Clients page**: `src/app/page.tsx` — `handleSortBy` (line 730) calls `setTablePage(1); setSortBy(s)`, which triggers both client-side re-sort (line 577 `filteredClients`) and a server refetch (line 613 `params.set("sort", sortBy)` → `useEffect` at line 657).
- **Profile page**: `src/app/profile/page.tsx` line 462 — `setSortBy={s => { setPage(1); setSortBy(s); }}` triggers a refetch.
- **Sort component**: `src/components/Select.tsx` — calls `onChange(o); cb.close(true)` on click. If `onChange` is a no-op, the dropdown closes and the current selection stays highlighted via `aria-selected={o === value}` (where `value` = `sortBy`).
- **Shared type**: `SortField` = `"recent" | "oldest" | "registered" | "registeredOldest"` (defined in `src/lib/client-types.ts`).

### Merge / Duplicates flow
- **Main button**: `src/app/page.tsx` line 2302 — `{isAdmin && <button onClick={onOpenDuplicates}>...}` — currently hidden for non-admins.
- **DuplicatesPanel**: `src/components/DuplicatesPanel.tsx` — individual merge buttons at lines 235–242 call `merge(group)`.
- **API route**: `src/app/api/crm/duplicates/route.ts` — `requireAdmin` (line 14) checks `canWrite(session.role)`. Both GET (duplicate detection) and POST (merge) use the same gate.
- **Auth helpers**: `src/lib/auth.ts` — `canWrite` (Admin/Sales/CRM), `canArchive` (Admin), `isAdmin` (Admin).

### Current merge logic
- **`mergeClients`** in `src/lib/db.ts` lines 1128–1226:
  - Updates the survivor with merged data.
  - **Deletes** source records: `await tx.client.deleteMany({ where: { id: { in: sources } } })` (line 1222).
  - Adds activity log entry with `action: "FIELD_EDIT"`, `field: "mergedIds"` (line 1204–1211).
- **`MergeResult`** type at line 1108: `{ survivorId, mergedIds, warnings }`.
- **`ActivityAction`** type in `src/lib/types.ts` line 1: union including `ARCHIVED`, `DELETED`, `FIELD_EDIT`, etc. (no `MERGED` action).
- **`describeActivity`** in `src/lib/reporting.ts` line 506: handles `ARCHIVED` → `t("act.archived", { name })`.

---

## Changes

### Requirement 1: Sort By dropdown — functional sort, menu stays open, no reorder

**Goal**: Selecting a sort option SHOULD reorder the list (client-side) and trigger a refetch (server). The dropdown should:
- Display the current sort
- Let the user open/close it
- **Stay open after clicking an option** so the user sees the checkmark move and can try another sort
- **Visually show the clicked option as selected** (checkmark moves)
- **Keep the menu order static** — the selected option does NOT jump to the top
- When manually closed, the last clicked option remains visually selected
- The actual list sort and server fetch **DO change** to match the selection

**Why this works**: The `Select` component (`src/components/Select.tsx`) uses `value` prop for `aria-selected={o === value}` and calls `onChange(o); cb.close(true)` on click. We add a `closeOnSelect` prop to `Select` (passed to `useCombobox`). For the Sort By dropdown we pass `closeOnSelect={false}` so the menu stays open after selection. The dropdown uses the REAL `sortBy` state and REAL `setSortBy` callback, so the list order and server fetch update.

**Critical fix for menu order**: The `useCombobox` hook (line 79-81) pins `selected` items at the top of the filtered list. To prevent the menu from reordering when selection changes, `Select.tsx` passes `selected: []` (empty array) to `useCombobox` instead of `value ? [value] : []`. The visual checkmark still works via `aria-selected={o === value}` in the render.

#### 1a. `src/components/Select.tsx` — add `closeOnSelect` prop + fix menu order
- Add `closeOnSelect?: boolean` to the component props (default `true` for backwards compatibility)
- Pass `closeOnSelect` to `useCombobox` (line 37)
- **Change `selected: value ? [value] : []` to `selected: []`** so the menu order stays static
- Update the click handler (line 94) to conditionally close: `onClick={() => { onChange(o); if (closeOnSelect !== false) cb.close(true); }}`

#### 1b. `src/components/ClientFilterBar.tsx` — use REAL sortBy + setSortBy + `closeOnSelect={false}`
- Remove the local `displaySortBy` state and `useState` import.
- Pass `value={sortBy}`, `onChange={v => setSortBy!(v as SortField)}`, and `closeOnSelect={false}` to the `Select`.
- The real `sortBy` and `setSortBy` from the parent are used directly.

```tsx
<Select
  value={sortBy}
  options={Object.keys(SORT_LABELS)}
  onChange={v => setSortBy!(v as SortField)}
  render={v => t(SORT_LABELS[v] ?? v)}
  searchable={false}
  closeOnSelect={false}
  t={t}
/>
```

#### 1c. `src/app/page.tsx` — RESTORE `handleSortBy` to reorder + refetch
- **Current** (no-op):
  ```ts
  const handleSortBy = (s: SortField) => {
    void s;
  };
  ```
- **New**: Restore the original behavior (reset page, change sort):
  ```ts
  const handleSortBy = (s: SortField) => {
    setTablePage(1);
    setSortBy(s);
  };
  ```

#### 1d. `src/app/profile/page.tsx` — RESTORE `setSortBy` prop
- **Current** (no-op):
  ```tsx
  setSortBy={_s => { void _s; }}
  ```
- **New**: Restore the original behavior:
  ```tsx
  setSortBy={s => { setPage(1); setSortBy(s); }}
  ```

**Validation**:
- `npx tsc --noEmit` (typecheck).
- `npm run lint` (lint).
- Manual: open the Sort By dropdown, click a different option — the checkmark moves to the clicked option, the menu **stays open**, the menu order **does not change**, the list **reorders client-side immediately**, the server **refetches** with the new sort, click another option — checkmark moves, list reorders again, click outside/press ESC to close — the selected option remains visually highlighted.

---

### Requirement 2: Role-based Merge permissions

**Goal**: Admin users can fully execute merges; standard users (Sales/CRM with `canWrite` but not Admin) can see the Merge button but it is non-functional (disabled with a tooltip).

#### 2a. `src/app/api/crm/duplicates/route.ts` — enforce Admin-only on POST
- Import `isAdmin` from `@/lib/auth` (in addition to existing `canWrite`).
- **GET handler** (line 23): Keep `canWrite` — viewing duplicate groups stays open to all write-capable roles. No change.
- **POST handler** (line 56): Change `requireAdmin` to enforce `isAdmin` instead of `canWrite`. Either:
  - Add a second guard function `requireAdminOnly` that checks `isAdmin(session.role)`, or
  - Inline the check:
    ```ts
    const session = await getSessionUser(request);
    if (!session || !isAdmin(session.role)) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    ```
  - Update the module-level JSDoc comment (line 5–12) to reflect that merge is Admin-only while detection is open to write-capable roles.

#### 2b. `src/app/page.tsx` — show Merge button to standard users, disabled
- **Current** (line 2302):
  ```tsx
  {isAdmin && <button className="btn-outline" onClick={onOpenDuplicates}><GitMerge size={14}/>{t("dupes.title")}</button>}
  ```
- **New**: Render for all `canEdit` users; disable the click for non-admins with a tooltip reusing the existing `errors.adminOnly` i18n key:
  ```tsx
  {canEdit && (
    <button
      className="btn-outline"
      disabled={!isAdmin}
      title={isAdmin ? undefined : t("errors.adminOnly")}
      onClick={isAdmin ? onOpenDuplicates : undefined}
    >
      <GitMerge size={14} />
      {t("dupes.title")}
    </button>
  )}
  ```
  - `canEdit` is already computed at line 698: `const canEdit = canWrite(user?.role);`
  - `isAdmin` is already passed to `ClientsView` at line 1356: `isAdmin={user.role === "Admin"}`

#### 2c. `src/components/DuplicatesPanel.tsx` — defense-in-depth: gate individual merge buttons
- Add `isAdmin: boolean` prop to the component signature (after `lang`).
- In the `merge` function (line 87), early-return if `!isAdmin`:
  ```ts
  if (!isAdmin) return;
  ```
  (Also guard the existing `busy` check.)
- On the individual merge button (line 237), set `disabled={!chosen || busy === key || !isAdmin}` and add `title={isAdmin ? undefined : t("errors.adminOnly")}`.
- Update the `DuplicatesPanel` call site in `src/app/page.tsx` (line 1481–1486) to pass `isAdmin={user.role === "Admin"}`.

#### 2d. i18n — no new keys required
- Reuse existing `errors.adminOnly`:
  - Arabic: `"هذه العملية متاحة للمديرين فقط."` (line 858)
  - English: `"Only admins can do this."` (line 1748)

**Validation**:
- `npx tsc --noEmit` (typecheck).
- `npm run lint` (lint).
- Manual: log in as Sales/CRM — Merge button visible but disabled with tooltip; log in as Admin — button is clickable.

---

### Requirement 3: Merge archives source records instead of deleting; flag as "Archived"

**Goal**: When an admin merges duplicates:
- The primary (surviving) client record is maintained.
- Non-selected duplicate records are **archived** (`archived = true`, `archivedAt = now()`) rather than deleted.
- The survivor's activity log explicitly records that the merged records were **archived** (action type `MERGED`, with `newValue` listing the archived IDs).

#### 3a. `src/lib/types.ts` — add `MERGED` to `ActivityAction`
- **Current** (line 1–10):
  ```ts
  export type ActivityAction =
    | "STATUS_CHANGE"
    | "FIELD_EDIT"
    | "NOTE_ADD"
    | "NOTE_EDIT"
    | "CREATED"
    | "DELETED"
    | "ARCHIVED"
    | "RESTORED"
    | "STATUS_CUSTOM_ADDED";
  ```
- **New**: Add `"MERGED"` to the union.

#### 3b. `src/lib/db.ts` — `mergeClients`: archive instead of delete + new activity entry
- **Line 1222** — replace deletion with archival:
  ```ts
  // OLD:
  await tx.client.deleteMany({ where: { id: { in: sources } } });
  // NEW:
  await tx.client.updateMany({
    where: { id: { in: sources } },
    data: { archived: true, archivedAt: new Date() },
  });
  ```
- **Lines 1204–1211** — change activity log entry from `FIELD_EDIT` to `MERGED`:
  ```ts
  // OLD:
  mergedLog.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor,
    action: "FIELD_EDIT",
    field: "mergedIds",
    newValue: sources.join(", "),
  });
  // NEW:
  mergedLog.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor,
    action: "MERGED",
    newValue: sources.join(", "),
  });
  ```
  - The `newValue` still lists the archived source IDs for traceability.
  - The action `MERGED` (handled in `describeActivity`) will produce a message that explicitly says "Archived."
- **Line 1224** (`return { survivorId: primary, mergedIds: sources, warnings };`) — add a warning:
  ```ts
  warnings.push(`archived ${sources.length} duplicate record(s)`);
  ```
- **Line 1108–1115** (`MergeResult` type) — update the JSDoc comment for `mergedIds` to say "archived" instead of "removed":
  ```ts
  /** IDs folded into the survivor and archived (not deleted). */
  mergedIds: string[];
  ```

#### 3c. `src/lib/reporting.ts` — handle `MERGED` action in `describeActivity`
- **Current** (line 497 area): `ActivityLike.action` is `string`, so no type change needed here.
- **Add** a new case in the switch (after the `ARCHIVED` case, around line 520):
  ```ts
  case "MERGED":
    return t("act.merged", { value: entry.newValue ?? "" });
  ```

#### 3d. `src/lib/i18n.tsx` — add `act.merged` key in both languages
- **Arabic** (`ar` object, near line 282):
  ```ts
  "act.merged": "تم دمج السجلات المكررة في هذا العميل وأرشفتها: {value}",
  ```
- **English** (`en` object, near line 1173):
  ```ts
  "act.merged": "Merged and archived duplicate records into this client: {value}",
  ```
  - `{value}` is the comma-separated list of archived source IDs — this is the explicit "Archived" flag within the merged dataset's activity log.

#### 3e. `src/app/clients/[id]/ClientDetailPage.tsx` — add `MERGED` icon
- **Line 378–385**: The `icons` map needs an entry for `MERGED`:
  ```ts
  MERGED: { icon: <GitMerge size={13} />, color: "#0ea5e0" },
  ```
  - Import `GitMerge` from `lucide-react` (add to the import at line 4).

#### 3f. `src/components/DuplicatesPanel.tsx` — update confirmation text
- The confirmation dialog at line 95 uses `t("dupes.confirm", ...)`. Update the i18n key to say "archived" instead of "permanently deleted":
  - **Arabic** (line 786):
    ```ts
    "dupes.confirm": "سيتم الاحتفاظ بـ "{keep}"\nوسيتم أرشفة السجلات التالية:\n{remove}\n\nهل تريد المتابعة؟",
    ```
  - **English** (line 1676):
    ```ts
    "dupes.confirm": "“{keep}” will be kept.\n\nThese records will be archived:\n{remove}\n\nContinue?",
    ```

**Validation**:
- `npx tsc --noEmit` (typecheck).
- `npm run lint` (lint).
- Manual: merge duplicate clients as Admin → archived page should now show the source records with `archived = true`; survivor's timeline should show a `MERGED` activity entry listing archived IDs.
- Post-merge, `findDuplicates` (which excludes archived records via `listClients`) should no longer show the resolved pair.

---

## Cross-cutting notes & risks

| Risk | Mitigation |
|------|-----------|
| Archived source records now live in the `archived` table view. | `findDuplicates` already excludes archived records (line 1044), so merged pairs won't reappear. |
| Existing `ActivityAction` consumers (ActivityFeedPanel, ClientDetailPage timeline) get a new action type. | Added icon mapping in `ClientDetailPage.tsx`; `describeActivity` handles it; unknown actions fall through to the `summary ?? t("act.unknown")` default. |
| `requireAdmin` in route.ts currently uses `canWrite` (broader). | POST changed to `isAdmin` only; GET stays `canWrite` so write-capable users can still view duplicate groups if they access the endpoint. |
| Pre-existing `findDuplicates(includeArchived)` bug: passing `true` calls `listClients({})` which doesn't actually include archived records. | Documented as pre-existing; not in scope of these requirements. Can be fixed separately if needed. |
| `MergeResult` is returned from the API but not displayed in the UI currently. | The `warnings` array will contain the archiving note. The activity log on the survivor is the authoritative traceability record. |

## Out of scope
- Column-level header sorting UI (not requested).
- Fixing the `findDuplicates(includeArchived)` bug (pre-existing).
- Migrating previously-deleted merge records (they're already gone from the DB).
- Displaying `MergeResult.warnings` in the UI (the panel currently ignores them).

## Task list (ordered)
1. Add `"MERGED"` to `ActivityAction` in `src/lib/types.ts`.
2. Update `mergeClients` in `src/lib/db.ts`: archive sources instead of deleting; change activity log entry to `MERGED` action; add archiving warning; update `MergeResult` comment.
3. Add `MERGED` case to `describeActivity` in `src/lib/reporting.ts`.
4. Add `act.merged` i18n key (Arabic + English) in `src/lib/i18n.tsx`.
5. Add `MERGED` icon + `GitMerge` import in `src/app/clients/[id]/ClientDetailPage.tsx`.
6. Update `dupes.confirm` i18n key (Arabic + English) in `src/lib/i18n.tsx`.
7. **Fix Sort By dropdown**: Add `closeOnSelect` prop to `src/components/Select.tsx`; pass it to `useCombobox`; **change `selected: []` to prevent menu reordering**; make click handler conditional.
8. **Fix Sort By dropdown**: Remove local `displaySortBy` state in `src/components/ClientFilterBar.tsx`; pass REAL `sortBy` + `setSortBy` to `Select` with `closeOnSelect={false}` so menu stays open but sort actually works.
9. **Restore Sort By callbacks**: Restore `handleSortBy` in `src/app/page.tsx` and `setSortBy` in `src/app/profile/page.tsx` to reorder client-side and refetch server.
10. Enforce Admin-only POST in `src/app/api/crm/duplicates/route.ts` (import `isAdmin`).
11. Show Merge button for `canEdit` users, disabled for non-admins, in `src/app/page.tsx` (line 2302).
12. Pass `isAdmin` to `DuplicatesPanel` and gate merge buttons inside, in `src/components/DuplicatesPanel.tsx`.
13. Run `npx tsc --noEmit` and `npm run lint` to validate.
