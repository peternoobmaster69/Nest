export function getSignInErrorMessage(error: string | undefined) {
  if (!error) return null;

  switch (error) {
    case "Callback":
      return "Sign-in could not be completed. Please try again.";
    case "OAuthCallback":
    case "OAuthSignin":
    case "OAuthCreateAccount":
      return "The provider sign-in flow failed. Please try again.";
    case "AccessDenied":
      return "Access was denied for this sign-in attempt.";
    default:
      return "Sign-in could not be completed. Please try again.";
  }
}
