const columns = ["Created", "Status", "Source", "Subject", "Bank", "Card", "Merchant", "Amount", "Txn Date", "Failure"];

export function CreditAlertsTableHead() {
  return <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>;
}
