import { createRequire } from "node:module";
import { patchNestJsSwagger } from "nestjs-zod";

export function patchSwaggerForZod(): void {
  try {
    const requireFromSwagger = createRequire(
      require.resolve("@nestjs/swagger"),
    );
    const { SchemaObjectFactory } = requireFromSwagger(
      "./services/schema-object-factory",
    );
    patchNestJsSwagger(SchemaObjectFactory);
  } catch (err) {
    console.warn(
      "Zod<->Swagger patch skipped; request schemas may be less detailed.",
      (err as Error).message,
    );
  }
}
