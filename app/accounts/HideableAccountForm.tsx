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
      <div className="account-card-head">
        <h2 className="account-card-title">Account details</h2>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="btn btn-ghost btn-sm"
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
