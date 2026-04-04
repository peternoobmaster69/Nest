declare module "swagger-ui-react" {
  import type { ComponentType } from "react";

  export type SwaggerUIProps = {
    url?: string;
    spec?: unknown;
  };

  const SwaggerUI: ComponentType<SwaggerUIProps>;
  export default SwaggerUI;
}
