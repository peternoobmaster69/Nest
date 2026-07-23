"use client";

import "swagger-ui-react/swagger-ui.css";
import dynamic from "next/dynamic";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
  loading: () => <p>Loading API documentation…</p>,
});

export function ApiDocsClient() {
  return <SwaggerUI url="/api/openapi" />;
}

