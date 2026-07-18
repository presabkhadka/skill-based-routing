import { createZodDto } from "nestjs-zod";
import { createSkillSchema } from "@skill-routing/shared";

export class CreateSkillDto extends createZodDto(createSkillSchema) {}
