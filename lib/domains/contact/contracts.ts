import { z } from "zod";

import { CONTACT_MESSAGE_MAX_LENGTH, CONTACT_TOPICS } from "./topics";
export { CONTACT_MESSAGE_MAX_LENGTH, CONTACT_TOPIC_LABELS, CONTACT_TOPICS } from "./topics";

export const ContactRequestSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120, "Name is too long."),
  email: z.string().trim().max(254, "Email is too long.").pipe(z.email("Enter a valid email address.")),
  topic: z.enum(CONTACT_TOPICS),
  message: z
    .string()
    .trim()
    .min(10, "Message should be at least 10 characters.")
    .max(CONTACT_MESSAGE_MAX_LENGTH, `Message must be ${CONTACT_MESSAGE_MAX_LENGTH} characters or fewer.`),
  // Honeypot: hidden from people, often filled by bots. Accepted here so the route can
  // discard filled submissions silently instead of revealing the trap in a 422.
  website: z.string().max(500).optional().default(""),
  // Milliseconds the form was open before submit; very fast submissions are bots.
  elapsedMs: z.number().int().nonnegative().optional(),
});

export type ContactRequest = z.infer<typeof ContactRequestSchema>;
