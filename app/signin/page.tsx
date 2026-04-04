import { SignInPanel } from "@/components/signin-panel";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export default async function SignInPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect("/");
  }
  return <SignInPanel />;
}
