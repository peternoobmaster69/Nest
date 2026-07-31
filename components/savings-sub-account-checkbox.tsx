import { Input } from "@/components/ui/controls";

export function SavingsSubAccountCheckbox({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
      <Input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
      <span>Mark as savings (included in net worth)</span>
    </label>
  );
}
