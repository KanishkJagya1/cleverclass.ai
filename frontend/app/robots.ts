import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/utils";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/account/",
          "/checkout",
          "/cart",
          "/login",
          "/signup",
          "/forgot-password",
          // Faceted URLs multiply into thousands of near-duplicate pages.
          // The canonical /shop and the class hubs carry the same inventory,
          // so crawling the facet space wastes budget on duplicates.
          "/shop?*",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl(""),
  };
}
