import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SkillsService } from "./skills.service";
import { CreateSkillDto } from "./dto";

@ApiTags("skills")
@Controller("skills")
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  findAll() {
    return this.skills.findAll();
  }

  @Get("offered")
  offeredSkills() {
    return this.skills.offeredSkills();
  }

  @Post()
  create(@Body() dto: CreateSkillDto) {
    return this.skills.create(dto.name);
  }
}
