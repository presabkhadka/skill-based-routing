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
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateTechnicianDto,
  ) {
    const technician = await this.technicians.update(id, dto);
    // A rename cannot invalidate an assignment; a shift or availability
    // change can, so only those two re-open the routing question.
    const affectsRouting =
      dto.workingHours !== undefined ||
      dto.available !== undefined ||
      dto.maxWorkload !== undefined;
    const reassignedRequestIds = affectsRouting
      ? await this.routing.revalidateFor(id)
      : [];
    return { technician, reassignedRequestIds };
  }

  @Put(":id/skills")
  async setSkills(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: SetSkillsDto,
  ) {
    const technician = await this.technicians.setSkills(id, dto.skills);
    const reassignedRequestIds = await this.routing.revalidateFor(id);
    return { technician, reassignedRequestIds };
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
    // Going away sheds their work; coming back adds capacity, which can pick
    // up anything queued or previously unroutable.
    const reassignedRequestIds = dto.available
      ? await this.routing.revalidateFor(id)
      : await this.routing.reassignFor(id);
    return { technician, reassignedRequestIds };
  }
}
