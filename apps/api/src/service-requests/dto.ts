import { createZodDto } from "nestjs-zod";
import { createServiceRequestSchema } from "@skill-routing/shared";

export class CreateServiceRequestDto extends createZodDto(
  createServiceRequestSchema,
) {}
