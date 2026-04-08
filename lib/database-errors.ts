export const DATABASE_UNAVAILABLE_CODE = "DATABASE_UNAVAILABLE";
export const DATABASE_UNAVAILABLE_MESSAGE =
  "Nest can't connect to the database right now. Please try again in a few minutes.";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

export function isDatabaseUnavailableError(error: unknown) {
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
