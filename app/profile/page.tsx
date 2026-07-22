import { PageFrame } from "@/components/page-frame";
import { ProfilePage } from "@/components/profile-page";
import { requireSession } from "@/lib/require-session";

export default async function ProfileRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame
      title="Profile"
      current="/profile"
      userName={userName}
      userEmail={session.user?.email || undefined}
      userImage={session.user?.image || null}
    >
      <ProfilePage
        userName={userName}
        userEmail={session.user?.email || undefined}
        userImage={session.user?.image || null}
      />
    </PageFrame>
  );
}
