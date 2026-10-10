import { Input, Select } from "@/components/ui/controls";

const GROUP_ICON_OPTIONS = [
  "📌", "🧳", "🛠️", "🎁", "🏥", "🚗", "🎓", "💼", "🎯", "✈️",
  "🏠", "🍽️", "🛒", "🎉", "💍", "👶", "🐾", "🎮", "📱", "💻",
  "🧾", "🏖️", "⛺", "🎵", "📚", "🏋️", "🚌", "🚆", "💡", "🩺",
] as const;

export function TransactionGroupFields({ name, icon, placeholder, disabled, onNameChange, onIconChange }: Readonly<{
  name: string;
  icon: string;
  placeholder?: string;
  disabled: boolean;
  onNameChange: (value: string) => void;
  onIconChange: (value: string) => void;
}>) {
  return (
    <div className="tx-group-name-row">
      <label className="tx-group-field tx-group-icon-field">
        Icon
        <Select className="input" value={icon} onChange={(event) => onIconChange(event.target.value)} aria-label="Group icon" disabled={disabled}>
          {Array.from(new Set([icon, ...GROUP_ICON_OPTIONS])).map((option) => <option key={option} value={option}>{option}</option>)}
        </Select>
      </label>
      <label className="tx-group-field">
        Name
        <Input className="input" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder={placeholder} maxLength={80} autoFocus required disabled={disabled} />
      </label>
    </div>
  );
}
