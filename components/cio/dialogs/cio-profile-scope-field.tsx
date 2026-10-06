import type { CioPlanningScope } from "@/components/cio/types";
import { SelectField } from "@/components/ui/form-field";

export function CioProfileScopeField({
  value,
  onChange,
}: Readonly<{
  value: CioPlanningScope;
  onChange: (value: CioPlanningScope) => void;
}>) {
  return (
    <SelectField
      label="Who are these calculations for?"
      value={value}
      onChange={(event) => onChange(event.target.value as CioPlanningScope)}
      hint={value === "INDIVIDUAL"
        ? "One-person plan. Partner details are not used, and the included CIO records should be yours alone."
        : "Combined plan. Enter combined spending and include household assets and flows; your age still sets the current projection timeline."}
    >
      <option value="INDIVIDUAL">Just me — individual plan</option>
      <option value="HOUSEHOLD">Me and a partner — household plan</option>
    </SelectField>
  );
}
