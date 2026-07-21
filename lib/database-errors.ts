export const DATABASE_UNAVAILABLE_CODE = "DATABASE_UNAVAILABLE";
export const DATABASE_UNAVAILABLE_MESSAGE =
  "Nest can't connect to the database right now. Please try again in a few minutes.";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

export function isDatabaseUnavailableError(error: unknown) {
  if (isDatabaseWakeTransientError(error)) return true;

  if (error && typeof error === "object") {
    const name = "name" in error && typeof error.name === "string" ? error.name : "";
    if (name === "PrismaClientInitializationError" || name === "PrismaClientRustPanicError") {
      return true;
    }
  }

  if (error instanceof Error && ["ESOCKET", "ETIMEOUT", "ELOGIN", "ECONNREFUSED"].includes(error.name)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  if (!message) return false;

  return [
    "can't reach database server",
    "authentication failed against database server",
    "database server",
    "failed to connect",
    "connection error",
    "login failed",
    "econnreset",
    "econnrefused",
    "etimeout",
    "esocket",
  ].some((fragment) => message.includes(fragment));
}

export function isDatabaseWakeTransientError(error: unknown) {
  if (error && typeof error === "object") {
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    if (["P1001", "P1002", "P2024"].includes(code)) return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  if (!message || /authentication failed|login failed|invalid credentials/.test(message)) {
    return false;
  }

  return [
    "40613",
    "40197",
    "database is unavailable",
    "database is not currently available",
    "database is in transition",
    "can't reach database server",
    "failed to connect",
    "connection error",
    "connection timeout",
    "econnreset",
    "econnrefused",
    "etimeout",
    "esocket",
  ].some((fragment) => message.includes(fragment));
}
