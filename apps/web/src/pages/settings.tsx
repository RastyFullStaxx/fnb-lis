import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useCurrentClient } from "@/api/location";
import { useProductTypes } from "@/api/master";
import {
  useCompanyInfo,
  useUpdateCompanyInfo,
  useUpdateProductTypes,
  type CompanyInfo,
} from "@/api/settings";
import { usePreferencesContext } from "@/lib/preferences";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SettingsPage() {
  const me = useMe();
  const role = (me.data?.user.role ?? "READONLY") as Role;

  return (
    <div>
      <PageHeader title="Settings" />
      {/* Flat sections split by hairlines — one surface, never stacked cards. */}
      <div className="divide-y">
        <DisplayPreferencesSection />
        <CompanySection />
        {can(role, "admin.manage") && <ProductTypesSection />}
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DisplayPreferencesSection() {
  const { preferences, setPreferences, isSaving } = usePreferencesContext();

  return (
    <SettingsSection
      title="Display"
      description="Personal preferences for how the app looks on this account — saved to your profile, so they follow you to any device you sign in on."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pref-font-size">Text size</Label>
          <Select
            value={preferences.fontSize}
            onValueChange={(v) =>
              setPreferences({ ...preferences, fontSize: v as typeof preferences.fontSize })
            }
            disabled={isSaving}
          >
            <SelectTrigger id="pref-font-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="large">Large</SelectItem>
              <SelectItem value="x-large">Extra large</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Scales text and controls across the whole app — similar to macOS's Large Text display
            setting.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pref-unit-system">Preferred unit of measurement</Label>
          <Select
            value={preferences.unitSystem}
            onValueChange={(v) =>
              setPreferences({ ...preferences, unitSystem: v as typeof preferences.unitSystem })
            }
            disabled={isSaving}
          >
            <SelectTrigger id="pref-unit-system">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="metric">Metric (g / kg)</SelectItem>
              <SelectItem value="imperial">Imperial (oz / lb)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Sets the default scale unit when weighing open bottles during counts.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

function CompanySection() {
  const client = useCurrentClient();
  const info = useCompanyInfo(client?.id ?? "");
  const update = useUpdateCompanyInfo(client?.id ?? "");
  const [form, setForm] = useState<CompanyInfo>({
    legalName: "",
    address: "",
    phone: "",
    email: "",
    reportFooter: "",
  });

  useEffect(() => {
    if (info.data) setForm(info.data);
  }, [info.data]);

  const set = (k: keyof CompanyInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Save stays disabled until something actually changed — at most one enabled
  // primary shows on the page at a time.
  const saved = info.data;
  const isDirty = !!saved && (Object.keys(form) as (keyof CompanyInfo)[]).some((k) => form[k] !== saved[k]);

  const save = async () => {
    try {
      await update.mutateAsync(form);
      toast.success("Company info saved — it now brands this client's reports");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    }
  };

  return (
    <SettingsSection
      title="Company information"
      description={`Appears on printed and exported reports for ${client?.name ?? "this client"}.`}
    >
      {info.isPending ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="legalName">Legal name</Label>
              <Input id="legalName" value={form.legalName} onChange={set("legalName")} placeholder={client?.name} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={set("phone")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input id="address" value={form.address} onChange={set("address")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cemail">Email</Label>
            <Input id="cemail" type="email" value={form.email} onChange={set("email")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="footer">Report footer note</Label>
            <Textarea
              id="footer"
              rows={2}
              value={form.reportFooter}
              onChange={set("reportFooter")}
              placeholder="e.g. Confidential — prepared for internal audit use."
            />
          </div>
          <Button onClick={save} disabled={update.isPending || !client || !isDirty}>
            Save company info
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

function ProductTypesSection() {
  const types = useProductTypes();
  const update = useUpdateProductTypes();
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (types.data) setList(types.data.productTypes);
  }, [types.data]);

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (list.some((t) => t.toLowerCase() === v.toLowerCase())) {
      toast.warning(`"${v}" is already in the list`);
      return;
    }
    setList((l) => [...l, v]);
    setDraft("");
  };

  const remove = (t: string) => setList((l) => l.filter((x) => x !== t));

  const savedTypes = types.data?.productTypes;
  const isDirty =
    !!savedTypes && (list.length !== savedTypes.length || list.some((t, i) => t !== savedTypes[i]));

  const save = async () => {
    try {
      await update.mutateAsync(list);
      toast.success("Product types updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save product types");
    }
  };

  return (
    <SettingsSection
      title="Product types"
      description="The universal classification behind categories and the Full Audit type filter (e.g. Beverage, Food, Supplies). Editing here is global across clients."
    >
      {types.isPending ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-28" />
          </div>
          <Skeleton className="h-9 w-full max-w-xs" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {list.map((t) => (
              <Badge key={t} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 text-sm">
                {t}
                <button
                  type="button"
                  onClick={() => remove(t)}
                  className="relative -my-1.5 grid size-6 place-items-center rounded-md before:absolute before:-inset-1.5 hover:bg-background/60"
                  aria-label={`Remove ${t}`}
                >
                  <X className="size-3.5" />
                </button>
              </Badge>
            ))}
            {list.length === 0 && <p className="text-sm text-muted-foreground">No product types yet.</p>}
          </div>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
              placeholder="Add a product type…"
              className="max-w-xs"
            />
            <Button type="button" variant="outline" onClick={add}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
          <Button onClick={save} disabled={update.isPending || !isDirty}>
            Save product types
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
