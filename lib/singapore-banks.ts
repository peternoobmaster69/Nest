export type SingaporeBank = {
  code: string;
  name: string;
  short: string;
  color: string;
  logoDomain?: string;
};

export const SINGAPORE_BANKS: SingaporeBank[] = [
  { code: "DBS", name: "DBS Bank", short: "DBS", color: "#D71920", logoDomain: "dbs.com.sg" },
  { code: "POSB", name: "POSB", short: "PS", color: "#E60012", logoDomain: "posb.com.sg" },
  { code: "OCBC", name: "OCBC Bank", short: "OC", color: "#E2001A", logoDomain: "ocbc.com" },
  { code: "UOB", name: "UOB", short: "UO", color: "#1F4BA5", logoDomain: "uob.com.sg" },
  { code: "CHOC", name: "Chocolate Finance", short: "CF", color: "#5A3A22", logoDomain: "chocolatefinance.com" },
  { code: "SC", name: "Standard Chartered", short: "SC", color: "#00A3A3", logoDomain: "sc.com" },
  { code: "CITI", name: "Citibank", short: "CT", color: "#1A4FA3", logoDomain: "citibank.com.sg" },
  { code: "HSBC", name: "HSBC", short: "HS", color: "#DB0011", logoDomain: "hsbc.com.sg" },
  { code: "MAYBANK", name: "Maybank", short: "MB", color: "#FFC72C", logoDomain: "maybank2u.com.sg" },
  { code: "CIMB", name: "CIMB", short: "CM", color: "#B20000", logoDomain: "cimb.com.sg" },
  { code: "BOC", name: "Bank of China", short: "BC", color: "#C6002B", logoDomain: "bankofchina.com" },
  { code: "ICBC", name: "ICBC", short: "IC", color: "#C41230", logoDomain: "icbc.com.cn" },
  { code: "RHB", name: "RHB Bank", short: "RH", color: "#005BBB", logoDomain: "rhbgroup.com" },
  { code: "ANZ", name: "ANZ", short: "AZ", color: "#0072CE", logoDomain: "anz.com" },
  { code: "SBI", name: "State Bank of India", short: "SB", color: "#00A0DF", logoDomain: "sbi.co.in" },
  { code: "BOI", name: "Bank of India", short: "BI", color: "#003A8C", logoDomain: "bankofindia.co.in" },
  { code: "MIZUHO", name: "Mizuho Bank", short: "MZ", color: "#003A70", logoDomain: "mizuhogroup.com" },
  { code: "MUFG", name: "MUFG Bank", short: "MF", color: "#E60012", logoDomain: "mufg.jp" },
  { code: "SMBC", name: "SMBC", short: "SM", color: "#006B54", logoDomain: "smbc.co.jp" },
  { code: "JPM", name: "JPMorgan Chase", short: "JP", color: "#2E5AAC", logoDomain: "jpmorganchase.com" },
  { code: "BNP", name: "BNP Paribas", short: "BN", color: "#00A651", logoDomain: "bnpparibas.com" },
  { code: "DB", name: "Deutsche Bank", short: "DB", color: "#0018A8", logoDomain: "db.com" },
  { code: "UBS", name: "UBS", short: "UB", color: "#E60000", logoDomain: "ubs.com" },
  { code: "TRUST", name: "Trust Bank", short: "TR", color: "#007A5E", logoDomain: "trustbank.sg" },
  { code: "GXS", name: "GXS Bank", short: "GX", color: "#FF5A5F", logoDomain: "gxs.com.sg" },
  { code: "MARI", name: "MariBank", short: "MR", color: "#5E2A84", logoDomain: "maribank.sg" },
];

export function getSingaporeBankByName(name: string | null | undefined) {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return (
    SINGAPORE_BANKS.find((b) => b.name.toLowerCase() === normalized) ||
    SINGAPORE_BANKS.find((b) => b.code.toLowerCase() === normalized) ||
    SINGAPORE_BANKS.find((b) => b.short.toLowerCase() === normalized) ||
    SINGAPORE_BANKS.find((b) => normalized.includes(b.name.toLowerCase().replace(" bank", ""))) ||
    SINGAPORE_BANKS.find((b) => compact.includes(b.name.toLowerCase().replace(/[^a-z0-9]/g, "").replace("bank", ""))) ||
    null
  );
}

export function getBankLogoUrl(bank: SingaporeBank | null | undefined) {
  if (!bank?.code) return null;
  return `/banks/${bank.code}.png`;
}
