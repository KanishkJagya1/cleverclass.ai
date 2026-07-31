import type { MetadataRoute } from "next";
import { SITE } from "@/constants/catalog";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — ${SITE.tagline}`,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#312E81",
    orientation: "portrait",
    lang: "en-IN",
    categories: ["education", "shopping", "books"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Shop books", url: "/shop" },
      { name: "Combo packs", url: "/combo-packs" },
      { name: "Key notes", url: "/key-notes" },
    ],
  };
}
