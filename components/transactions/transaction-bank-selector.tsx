import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { BankAccount } from "@/lib/accounts";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { getAmountToneClass } from "@/lib/transaction-presentation";

function BankBadge({ bank, failed, onError }: Readonly<{ bank: BankAccount | null; failed: boolean; onError: () => void }>) {
  if (!bank) return <span className="bank-icon bank-icon-default">ALL</span>;
  const metadata = getSingaporeBankByName(bank.bankName || bank.name);
  if (!metadata) return <span className="bank-icon bank-icon-default">BNK</span>;
  if (failed) return <span className="bank-icon" style={{ backgroundColor: metadata.color }}>{metadata.short}</span>;
  return <Image src={getBankLogoUrl(metadata)!} alt={metadata.name} width={44} height={24} sizes="44px" className={`bank-logo-img ${metadata.code === "DBS" ? "bank-logo-img-dbs" : ""}`} loading="lazy" onError={onError} />;
}

export function TransactionBankSelector({ accounts, selected, balanceCents, open, busy, formatAmount, onOpenChange, onSelect, onEdit }: Readonly<{
  accounts: readonly BankAccount[];
  selected: BankAccount | null;
  balanceCents: number;
  open: boolean;
  busy: boolean;
  formatAmount: (value: number) => string;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onEdit: (bank: BankAccount) => void;
}>) {
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const canChoose = accounts.length > 1;
  const pickerVisible = open && canChoose;
  useEffect(() => {
    if (!pickerVisible) return;
    const outside = (event: MouseEvent) => {
      if (!pickerRef.current!.contains(event.target as Node)) onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onOpenChange(false);
      triggerRef.current!.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [pickerVisible, onOpenChange]);

  const choose = (id: string) => { onSelect(id); onOpenChange(false); };
  return (
    <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
      <div className="bank-selector-summary">
        <div className="bank-selector-main">
          <BankBadge bank={selected} failed={Boolean(selected && failedLogos[selected.id])} onError={() => setFailedLogos((previous) => ({ ...previous, [selected!.id]: true }))} />
          <div className={`bank-selector-amount ${getAmountToneClass(balanceCents)}`}>{formatAmount(balanceCents)}</div>
        </div>
        <div className="bank-selector-actions" ref={pickerRef}>
          {canChoose ? <Button ref={triggerRef} type="button" className="bm-edit-btn tx-bank-action-btn" onClick={() => onOpenChange(!open)} aria-label="Choose bank" title="Choose bank" aria-expanded={pickerVisible} aria-controls="transaction-bank-options">▾</Button> : null}
          {selected ? <Button type="button" className="bm-edit-btn tx-bank-action-btn" onClick={() => onEdit(selected)} disabled={busy} aria-label={`Edit ${selected.name} balance`} title="Edit balance">✎</Button> : null}
          {pickerVisible ? (
            <div id="transaction-bank-options" className="bank-selector-menu" role="group" aria-label="Bank options">
              <Button type="button" className={`bank-selector-option${selected ? "" : " is-active"}`} aria-pressed={!selected} onClick={() => choose("")}>All banks</Button>
              {accounts.map((bank) => <Button key={bank.id} type="button" className={`bank-selector-option${selected?.id === bank.id ? " is-active" : ""}`} aria-pressed={selected?.id === bank.id} onClick={() => choose(bank.id)}>{bank.name}</Button>)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
