# Nest money management guide

Nest is a full-visibility money system. It brings together the money you have, money owed to you, credit-card amounts you owe, and the current value of your investments.

The system uses a virtual-account, or envelope, model:

- **Bank accounts** represent real cash and act as control totals.
- **Sub-accounts** divide that cash into purposes such as Bills, Groceries, Card Settlement, Emergency Savings, or Investing.
- **Credit-card statements** represent payables: amounts you owe but have not yet paid from a bank account.
- **Receivables** represent amounts other people or workspaces owe you.
- **Investments** are valued separately using dated snapshots.
- **Monthly budgets** plan where income should go and can fund the linked sub-accounts when confirmed.

Nest is a visibility and allocation system rather than a bank feed or a formal double-entry accounting package. It shows the different sides of your money together, but some real balances and valuations must be kept up to date manually.

## The mental model

Think about your finances through four connected views.

| View | What it answers | Where it lives in Nest |
| --- | --- | --- |
| Real cash | How much is actually in each bank account? | Accounts and Dashboard |
| Purpose | What is that cash meant for? | Sub-accounts and Transactions |
| Commitments | What do I owe, and what is owed to me? | Credit Transactions and Receivables |
| Long-term value | What are my investments worth now? | Investments |

The core reconciliation for each bank account is:

```text
Configured bank balance - total of linked sub-accounts = unallocated amount
```

- A **positive** result is cash that has not yet been assigned to a sub-account.
- Zero means every unit of cash has a stated purpose.
- A **negative** result means the sub-accounts are over-allocated beyond the configured bank balance.

Nest treats the configured bank balance as the source of truth. Transactions change sub-account balances and cash-flow reporting; they do not automatically change the configured bank balance. After money actually enters or leaves the bank, update that account's balance to match the bank.

This separation is intentional. A card purchase, for example, can reserve money in a virtual Card Settlement sub-account while the real money remains in the bank until the statement is paid.

## Important terms

### Bank account

A bank account represents a real account at a financial institution. Its configured balance is the amount Nest shows as available bank balance. Despite the underlying field being called a starting balance, it is used as the current control balance in the app.

### Sub-account

A sub-account is a virtual slice of one bank account. It does not open or move money at the bank. It gives existing cash a purpose.

Each sub-account has:

- an **available balance**, changed by credits and debits;
- an optional **target**, used as a goal or reference rather than a hard limit;
- a parent bank account;
- transactions and optional transaction groups.

Sub-accounts may go negative. Nest uses the negative balance as a warning that a purpose has spent or committed more than was assigned to it.

### Transaction

A transaction is a ledger movement attached to both a bank account and one of its sub-accounts.

- A **credit** adds to the sub-account.
- A **debit** deducts from the sub-account.
- A **transfer** creates an equal debit and credit between two sub-accounts.

A transfer within one bank account only reallocates cash. A transfer across two bank accounts also needs to happen at the banks, followed by an update to both configured bank balances.

### Credit-card payable

A credit-card transaction creates or increases a liability. It is not a bank withdrawal yet. Nest groups card activity by card and statement month, tracks the payment due date, and sums the outstanding amount. A card payment is stored as an offsetting negative card transaction, reducing the statement's outstanding balance.

### Receivable

A receivable records money expected from someone else. Open and partial receivables are included in the receivable total. A receivable can optionally remember a source account and sub-account, including one in another workspace to which you have access.

### Investment account

An investment account is a series of dated snapshots. Each entry stores cumulative invested capital and current value. Nest calculates gain or loss as current value minus invested capital. Marking an account liquid includes its latest value in the amount available to withdraw.

## Recommended initial setup

### 1. Set the workspace currency

Choose the base display currency in Settings. Values throughout the workspace are displayed in this currency; Nest does not automatically perform foreign-exchange conversion for these money views.

### 2. Create the real bank accounts

Add each bank account you want to manage and enter its current balance. Use the balance shown by the bank, including posted transactions, as the control value.

### 3. Create sub-accounts for the jobs your money has

A useful starting structure is:

- Everyday Spending
- Bills
- Card Settlement / Receivables
- Emergency Savings
- Goals or Travel
- Investing
- Unassigned Buffer

Every sub-account belongs to exactly one bank account. Keep the structure meaningful but reasonably small; transaction groups can provide more detail inside a sub-account without creating dozens of envelopes.

For savings to appear in Nest's Dashboard and public net-worth calculation, use the shield icon (`🛡️`). A sub-account with no custom icon is also treated as savings when its name contains `savings` or `emergency`. Savings remains cash in its parent bank account—it is not a separate asset to add a second time in your own consolidated calculation.

### 4. Configure the receivable defaults

In Settings, choose the **Receivable Default Account** and **Receivable Default Subaccount**. Nest uses this pair as a clearing and settlement destination:

- closed receivables are credited there;
- card-accounting flows can move reserved money there;
- credit-card payments are deducted from there.

A dedicated sub-account such as **Card Settlement / Receivables** makes this flow easy to understand. The account and sub-account must remain active and must belong together.

### 5. Add credit cards

For each card, add its statement day, payment due day, and identifying details. Card transactions may be entered manually, imported where supported, or captured from supported Gmail card alerts. Review the statement month and due date because those fields drive payable totals and reminders.

### 6. Add investment accounts

Create each investment product, set its inception date and liquidity, then add the first valuation entry with:

- total capital invested to date; and
- current market or redemption value.

Investment entries do not automatically move bank or sub-account balances. Record both sides of a contribution or withdrawal as described below.

## How common money events work

| Event | Bank control balance | Source sub-account | Destination sub-account | Payable or receivable | Investment value |
| --- | --- | --- | --- | --- | --- |
| Confirm monthly budget | Update only when income is real | — | Credit linked destinations | — | — |
| Cash or bank expense | Update from the bank | Debit | — | — | — |
| Income received | Update from the bank | — | Credit | — | — |
| Sub-account transfer | No change for same-bank transfer | Debit | Credit | — | — |
| Card purchase recorded | No change | No immediate change | No immediate change | Card payable increases | — |
| Card purchase deducted and reserved | No change | Debit spending purpose | Credit settlement purpose | Marked accounted; payable remains | — |
| Reimbursable card purchase | No change | Optional later source | — | Card payable and receivable are visible | — |
| Receivable closed | Update when cash arrives | Optional debit | Credit default destination | Receivable becomes paid | — |
| Card statement paid | Update when cash leaves | Debit default settlement purpose | — | Payable decreases | — |
| Investment contribution | Update when cash leaves | Debit Investing purpose | — | — | Update invested and current value |
| Investment withdrawal | Update when cash arrives | — | Credit a chosen purpose | — | Reduce current value and, where appropriate, invested capital |

The bank-control column says when the real account should be refreshed. Nest does not perform that refresh automatically.

## Monthly budgeting

The Budget Plan separates a reusable setup from a specific month.

### Budget Setup

Setup contains templates for:

- **sources**, such as salary, freelance income, or a household member's contribution; and
- **budget items**, such as rent, groceries, savings, investing, or card settlement.

A source can have an owner. A budget item can point to a destination sub-account. Only items marked monthly are copied when starting a month from Setup.

### Monthly plan

Start the month either from Setup or as a blank plan. Adjust the sources and items for what is actually expected that month.

Before confirmation:

```text
total sources = total budget items
```

Nest will not confirm an empty or unbalanced plan. Confirmation makes the plan read-only and credits each linked destination sub-account by its budget-item amount. Items without a destination remain part of the plan but are not applied to any sub-account.

Confirmation allocates virtual money; it does not create cash in a bank account. When salary or another source actually arrives, update the real bank balance. A discrepancy between the bank and the newly funded sub-accounts tells you that income is not yet received, the bank balance is stale, or the plan allocated more than the available cash.

## Spending from a bank account

For a debit-card purchase, transfer, fee, or other direct withdrawal:

1. Record a debit against the sub-account that funded the expense.
2. Update the configured bank balance when the withdrawal is posted by the bank.
3. Check that the bank's linked sub-accounts reconcile.

For income received directly into a bank account:

1. Update the configured bank balance.
2. Credit the appropriate sub-account, or allocate the income through the monthly plan.
3. Assign any positive unallocated amount that remains.

Transaction groups can organize related transactions inside one sub-account—for example, grouping flights and hotels under a particular trip. Deleting a group leaves its transactions in the sub-account.

## Credit cards and payables

Credit cards have two distinct stages: **accounting for purchases** and **paying the statement**.

### Stage 1: record and account for each purchase

A recorded card purchase increases the statement payable but does not touch the bank balance. Until it is accounted, Nest labels it unaccounted.

For a normal personal expense, choose **Deduct**:

1. Select the bank account and spending sub-account that own the cost.
2. Nest debits that source sub-account.
3. If a destination is selected—or the workspace default is configured—Nest credits the destination sub-account by the same amount.
4. The card purchase is marked accounted.

Using the Card Settlement / Receivables sub-account as the destination reserves the payment cash without changing the total allocated across the bank. The spending budget falls, the settlement balance rises, and the card payable remains visible until paid.

For an expense that another person should repay, choose **Create Receivable**. The card payable remains visible and an open receivable is created for the matching asset. If the source belongs to another workspace, select its bank account and sub-account so Nest knows where to post the eventual source deduction.

The accounted checkbox can also mark a transaction accounted without creating a ledger movement. Use that only when the purchase has already been handled elsewhere; otherwise the card total can appear complete while no sub-account contains the matching reservation or receivable.

### Stage 2: pay the statement

Select one card and statement month, verify the due date and outstanding total, then choose **Pay**. Nest:

- deducts the payment from the Receivable Default Subaccount; and
- creates an offsetting card payment that reduces the statement payable.

Nest prevents a payment larger than the current outstanding statement amount. After the real bank payment posts, update the configured bank balance. The lower bank balance and lower settlement sub-account should then reconcile.

The Credit Transactions summary compares the card total with the default settlement balance plus open receivables. A balanced result means every card amount has a visible funding or recovery path; it does not mean the statement has already been paid.

### Example: a personal card purchase

Assume a bank balance of `$5,000`, with all `$5,000` allocated across sub-accounts.

1. A `$120` grocery purchase is recorded on the card. The bank remains `$5,000`; card payable becomes `$120`.
2. Deduct it from Groceries and direct it to Card Settlement. Groceries falls by `$120`, Card Settlement rises by `$120`, and total allocated remains `$5,000`.
3. Pay the statement. Card Settlement falls by `$120`, and card payable returns to zero.
4. When the bank posts the payment, update its balance to `$4,880`. Linked sub-accounts should also total `$4,880`.

## Receivables

Use Receivables for reimbursements, shared purchases, loans to family or friends, or any other expected repayment.

An open receivable is visible as money owed to you, but it is not yet bank cash. If it is associated with a source sub-account, Nest also displays the open amount as reserved against that source for visibility.

When payment is received, use **Close** on the Receivables page. Closing:

- marks the receivable paid;
- credits the Receivable Default Account and Subaccount;
- optionally debits the recorded source sub-account when the source and destination differ; and
- creates linked transactions so the movement remains traceable.

Then update the configured bank balance to include the received cash.

Changing a receivable's status to `PAID` manually, or using a quick action that only marks it paid, is not the same as **Close**: it may not create the cash and sub-account postings. Use Close when money was actually received and you want the ledger updated.

`PARTIAL` is available as a status, but the current close action settles the receivable's full recorded amount. If only part was received, update or split the receivable deliberately before closing so the posted amount matches reality.

### Example: a reimbursable card purchase

1. You pay `$80` for someone else using a card. Card payable increases by `$80`.
2. Create an `$80` receivable from that card transaction. You can now see both the liability and the expected recovery.
3. When the person pays, your bank cash rises by `$80`. Close the receivable so the default settlement sub-account also rises by `$80`, then update the bank balance.
4. Pay the card statement. The settlement sub-account and real bank cash each fall by `$80`, and the card payable is offset.

If the card is due before the reimbursement arrives, the settlement sub-account may go negative when you pay. That accurately shows that other cash temporarily funded the receivable.

## Savings and investments

### Savings

Savings is a purpose assigned to cash, so model it as a sub-account linked to the bank where the cash actually sits. Use the shield icon so it is included in Nest's savings and net-worth views.

Moving money into Savings is a sub-account transfer. Moving it to a different bank also requires the real bank transfer and an update to both account balances.

### Investments

Investment accounts do not automatically connect to bank transactions. For a contribution:

1. Debit the Investing sub-account.
2. Update the bank balance after the cash leaves.
3. Add an investment entry with the new cumulative invested amount and current value.

For a valuation-only update, add or edit an investment entry without changing bank or sub-account balances. For a withdrawal or divestment, reduce the investment snapshot, update the receiving bank balance, and credit the sub-account that receives the proceeds. A divested date is descriptive metadata; keep the latest current value accurate so portfolio totals are not overstated.

The Investments page shows total current value, total invested, gain or loss, return percentage, and the current value of accounts marked liquid.

## What the Dashboard totals mean

- **Available bank balance** is the sum of configured bank balances in the selected view.
- **Allocated** is the sum of active linked sub-account balances.
- **Unallocated** is available bank balance minus allocated.
- **Credit-card outstanding** is the sum of unpaid card-statement activity.
- **Receivables** show expected repayments and are not included in bank cash before receipt.
- **Net worth** in the Dashboard is a focused Nest measure: savings sub-accounts plus latest investment values. It is not a complete balance-sheet net worth and does not subtract credit-card payables or include every non-savings bank sub-account.

The public net-worth endpoint uses the same savings-plus-investments concept. Its liquid amount includes savings plus only investment accounts marked liquid.

For a personal consolidated net-worth calculation, avoid double-counting savings because those sub-accounts are already part of their parent bank balances, and subtract outstanding card liabilities from the assets you choose to include.

## A reliable operating rhythm

### During the month

- Record direct bank transactions against the correct sub-account.
- Capture or import card purchases and account for every one as a deduction or receivable.
- Record new receivables when money becomes owed to you.
- Update bank control balances often enough that discrepancies remain meaningful.

### When money is received

- Update the bank balance.
- Credit or allocate the money to sub-accounts.
- Close any receivable that the payment settles.

### Before a card due date

- Select the card and statement month.
- Verify the statement total and due date.
- Resolve every unaccounted transaction.
- Check that settlement funds plus open receivables explain the payable.
- Make the payment and update the real bank balance after it posts.

### At month end

- Reconcile each bank balance to its linked sub-accounts.
- Investigate all unallocated or over-allocated amounts.
- Review open and partial receivables.
- Confirm that card payments reduced the correct statement months.
- Add current investment valuations.
- Prepare and balance the next monthly budget before confirming it.

## Reading discrepancies as useful signals

| Signal | Likely meaning | What to check |
| --- | --- | --- |
| Positive unallocated amount | Real cash has not been assigned | New income, refunds, stale allocations, or a newly updated bank balance |
| Negative unallocated amount | More virtual money was assigned than the bank holds | Premature monthly confirmation, stale bank balance, duplicate credits, or overspending |
| Card deficit | Part of the statement has no settlement reserve or receivable | Unaccounted transactions or deductions without the expected destination |
| Card surplus | Settlement and receivable values exceed the selected statement | Other receivables in the default account, wrong statement filter, or duplicate allocations |
| Negative sub-account | That purpose is underfunded | Reallocate from another sub-account or accept it as a visible shortfall |
| Investment total looks too high | Latest snapshot is stale | Update current value, especially for sold or divested products |

The goal is not to hide discrepancies. It is to keep each one small, explainable, and temporary so that you can see where your money is, what it is for, what is still owed, and what must happen next.
