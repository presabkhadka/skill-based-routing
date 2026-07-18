import {
  Body,
  Controller,
  forwardRef,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { TechniciansService } from "./technicians.service";
import { RoutingService } from "../routing/routing.service";
import {
  CreateTechnicianDto,
  UpdateTechnicianDto,
  SetAvailabilityDto,
  SetSkillsDto,
} from "./dto";

@ApiTags("technicians")
@Controller("technicians")
export class TechniciansController {
  constructor(
    private readonly technicians: TechniciansService,
    @Inject(forwardRef(() => RoutingService))
    private readonly routing: RoutingService,
  ) {}

  @Get()
  findAll() {
    return this.technicians.findAll();
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.technicians.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTechnicianDto) {
    return this.technicians.create(dto);
  }

  @Patch(":id")
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateTechnicianDto,
  ) {
    return this.technicians.update(id, dto);
  }

  @Put(":id/skills")
  setSkills(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: SetSkillsDto,
  ) {
    return this.technicians.setSkills(id, dto.skills);
  }

  @Patch(":id/availability")
  async setAvailability(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: SetAvailabilityDto,
  ) {
    const technician = await this.technicians.setAvailability(
      id,
      dto.available,
    );
    const reassignedRequestIds = dto.available
      ? []
      : await this.routing.reassignFor(id);
    return { technician, reassignedRequestIds };
  }
}
