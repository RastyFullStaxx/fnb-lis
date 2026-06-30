import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { approvals as initialApprovals, importRows as initialRows } from "../data/fixtures";
import type { Approval, CountLine, ImportRow, Role } from "../types";

interface AppState {
  role: Role;
  setRole: (role: Role) => void;
  site: string;
  setSite: (site: string) => void;
  countLines: Record<string, CountLine>;
  updateCount: (line: CountLine) => void;
  importRows: ImportRow[];
  updateImportRow: (id: string, patch: Partial<ImportRow>) => void;
  importCommitted: boolean;
  commitImport: () => void;
  approvals: Approval[];
  decideApproval: (id: string, decision: "Approved" | "Rejected") => void;
  toast: string;
  notify: (message: string) => void;
}

const Context = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("owner");
  const [site, setSite] = useState("BGC Flagship");
  const [countLines, setCountLines] = useState<Record<string, CountLine>>({});
  const [importRows, setImportRows] = useState(initialRows);
  const [importCommitted, setImportCommitted] = useState(false);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [toast, setToast] = useState("");

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const value = useMemo<AppState>(
    () => ({
      role,
      setRole,
      site,
      setSite,
      countLines,
      updateCount: (line) =>
        setCountLines((current) => ({ ...current, [line.itemId]: line })),
      importRows,
      updateImportRow: (id, patch) =>
        setImportRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row))),
      importCommitted,
      commitImport: () => {
        setImportCommitted(true);
        notify("Import committed to the prototype journal.");
      },
      approvals,
      decideApproval: (id, decision) => {
        setApprovals((rows) => rows.map((row) => (row.id === id ? { ...row, status: decision } : row)));
        notify(`Request ${decision.toLowerCase()}.`);
      },
      toast,
      notify
    }),
    [approvals, countLines, importCommitted, importRows, role, site, toast]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
