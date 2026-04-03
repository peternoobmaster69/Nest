import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nest",
    short_name: "Nest",
    description: "Nest Personal Finance Companion",
    start_url: "/",
    display: "standalone",
    background_color: "#1C2B1C",
    theme_color: "#1C2B1C",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    orientation: "portrait",
    scope: "/",
    lang: "en",
  };
}
