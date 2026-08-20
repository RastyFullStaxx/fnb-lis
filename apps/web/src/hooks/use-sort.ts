import { useMemo, useReducer } from "react";

/**
 * Client-side table sorting, matching the Amkor DataTable's sort behavior:
 * clicking a column cycles none → asc → desc → none, and clicking a
 * different column always starts that column at asc.
 *
 * Usage:
 *   const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(rows);
 *   ...
 *   <SortableTableHead sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
 *     Name
 *   </SortableTableHead>
 *   ...
 *   {sortedRows.map(...)}
 *
 * Pass an explicit `accessor` when the sort value isn't a plain property
 * on the row (e.g. it's nested, computed, or the column renders something
 * other than the raw field):
 *
 *   useSort(rows, { accessors: { total: (r) => r.qty * r.unitCost } })
 */

export type SortDirection = "asc" | "desc";

interface SortState {
  key: string | null;
  dir: SortDirection;
}

const initialState: SortState = { key: null, dir: "asc" };

function sortReducer(state: SortState, clickedKey: string): SortState {
  if (state.key !== clickedKey) return { key: clickedKey, dir: "asc" };
  if (state.dir === "asc") return { key: clickedKey, dir: "desc" };
  return initialState;
}

type Accessor<T> = (row: T) => unknown;

/** The actual comparison used by both hooks below — extracted so
    useGroupSort can share it instead of re-implementing the same
    number/date/locale rules. Behavior is unchanged from before the
    extraction; this is a pure refactor. */
function compareSortValues(a: unknown, b: unknown, dir: SortDirection): number {
  const av = a ?? "";
  const bv = b ?? "";

  if (typeof av === "number" && typeof bv === "number") {
    return dir === "asc" ? av - bv : bv - av;
  }

  const da = Date.parse(String(av));
  const db = Date.parse(String(bv));
  if (!isNaN(da) && !isNaN(db) && (av instanceof Date || bv instanceof Date || /\d{4}-\d{2}-\d{2}/.test(String(av)))) {
    return dir === "asc" ? da - db : db - da;
  }

  return dir === "asc"
    ? String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" })
    : String(bv).localeCompare(String(av), undefined, { numeric: true, sensitivity: "base" });
}

export function useSort<T>(
  rows: T[],
  options?: {
    /** Per-column value getters, keyed by the same key passed to toggleSort/SortableTableHead. */
    accessors?: Record<string, Accessor<T>>;
  },
) {
  const [state, dispatch] = useReducer(sortReducer, initialState);

  const sortedRows = useMemo(() => {
    if (!state.key) return rows;
    const accessor = options?.accessors?.[state.key] ?? ((row: T) => (row as Record<string, unknown>)[state.key as string]);

    return [...rows].sort((a, b) => compareSortValues(accessor(a), accessor(b), state.dir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, state.key, state.dir, options?.accessors]);

  function toggleSort(key: string) {
    dispatch(key);
  }

  return {
    sortedRows,
    sortKey: state.key,
    sortDirection: state.dir,
    toggleSort,
  };
}

/**
 * Same click-to-sort UX as useSort, for tables that are banded into fixed
 * groups (a category header + subtotal row wrapped around each group's own
 * rows, e.g. legacy-audit.tsx / full-audit.tsx's per-category sections
 * rendered inside ONE physical table with ONE shared sticky header).
 *
 * A single sort control (one header row) re-sorts every group's rows by the
 * same column/direction, independently within each group — group order and
 * each group's own totals/footer row are untouched, only the row order
 * inside each group changes. This is the grouped-table equivalent of
 * calling useSort separately per group, which Rules of Hooks doesn't allow
 * inside a dynamic .map, and which wouldn't have anywhere to hang a single
 * shared header control anyway.
 *
 * Usage:
 *   const { sortedGroups, sortKey, sortDirection, toggleSort } = useGroupSort(groups, {
 *     accessors: { total: (r) => r.qty * r.unitCost },
 *   });
 *   ...
 *   <SortableTableHead sortKey="total" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
 *     Total
 *   </SortableTableHead>
 *   ...
 *   {sortedGroups.map((group) => ...)}
 */
export function useGroupSort<G extends { rows: T[] }, T>(
  groups: G[],
  options?: {
    /** Per-column value getters, keyed by the same key passed to toggleSort/SortableTableHead. */
    accessors?: Record<string, Accessor<T>>;
  },
) {
  const [state, dispatch] = useReducer(sortReducer, initialState);

  const sortedGroups = useMemo(() => {
    if (!state.key) return groups;
    const accessor = options?.accessors?.[state.key] ?? ((row: T) => (row as Record<string, unknown>)[state.key as string]);

    return groups.map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => compareSortValues(accessor(a), accessor(b), state.dir)),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, state.key, state.dir, options?.accessors]);

  function toggleSort(key: string) {
    dispatch(key);
  }

  return {
    sortedGroups,
    sortKey: state.key,
    sortDirection: state.dir,
    toggleSort,
  };
}
