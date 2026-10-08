export const CONTACT_TOPICS = ["general", "hosting", "feedback", "bug"] as const;

export const CONTACT_TOPIC_LABELS: Record<(typeof CONTACT_TOPICS)[number], string> = {
  general: "General question",
  hosting: "Hosting or self-hosting",
  feedback: "Feedback or idea",
  bug: "Something isn't working",
};

export const CONTACT_MESSAGE_MAX_LENGTH = 4000;

