import { createZodDto } from "nestjs-zod";
import {
  createTechnicianSchema,
  updateTechnicianSchema,
  setAvailabilitySchema,
  setSkillsSchema,
} from "@skill-routing/shared";

export class CreateTechnicianDto extends createZodDto(
  createTechnicianSchema,
) {}
export class UpdateTechnicianDto extends createZodDto(
  updateTechnicianSchema,
) {}
export class SetAvailabilityDto extends createZodDto(
  setAvailabilitySchema,
) {}
export class SetSkillsDto extends createZodDto(setSkillsSchema) {}
