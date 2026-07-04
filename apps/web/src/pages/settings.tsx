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
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsPage() {
  const me = useMe();
  const role = (me.data?.user.role ?? "READONLY") as Role;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Company details that brand your reports, and the product-type list that classifies your catalog."
      />
      <CompanyCard />
      {can(role, "admin.manage") && <ProductTypesCard />}
    </div>
  );
}

function CompanyCard() {
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

  const save = async () => {
    try {
      await update.mutateAsync(form);
      toast.success("Company info saved — it now brands this client's reports");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Company information</CardTitle>
        <CardDescription>
          Appears on printed and exported reports for {client?.name ?? "this client"}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {info.isPending ? (
          <Skeleton className="h-56 w-full" />
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
            <Button onClick={save} disabled={update.isPending || !client}>
              Save company info
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProductTypesCard() {
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

  const save = async () => {
    try {
      await update.mutateAsync(list);
      toast.success("Product types updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save product types");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Product types</CardTitle>
        <CardDescription>
          The universal classification behind categories and the Full Audit type filter (e.g. Beverage,
          Food, Supplies). Editing here is global across clients.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {types.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {list.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 text-sm">
                  {t}
                  <button
                    type="button"
                    onClick={() => remove(t)}
                    className="rounded-full p-0.5 hover:bg-background/60"
                    aria-label={`Remove ${t}`}
                  >
                    <X className="size-3" />
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
            <Button onClick={save} disabled={update.isPending}>
              Save product types
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
