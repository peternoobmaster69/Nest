"use client";

import { useState } from "react";
import AccountForm, { AccountFormProps } from "./AccountForm";

type Props = {
  mode: AccountFormProps["mode"];
  account?: AccountFormProps["account"];
  defaultVisible?: boolean;
};

export default function HideableAccountForm({ mode, account, defaultVisible = false }: Props) {
  const [visible, setVisible] = useState<boolean>(defaultVisible);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">{account?.Name}</h2>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          {visible ? "Done" : "Edit"}
        </button>
      </div>

      {visible ? (
        <AccountForm mode={mode} account={account} />
      ) : (
        <div></div>
      )}
    </div>
  );
}
