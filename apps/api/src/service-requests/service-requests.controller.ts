import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ServiceRequestsService } from "./service-requests.service";
import { CreateServiceRequestDto } from "./dto";

@ApiTags("service-requests")
@Controller("service-requests")
export class ServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Get()
  findAll() {
    return this.requests.findAll();
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.requests.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateServiceRequestDto) {
    return this.requests.create(dto);
  }

  @Post(":id/route")
  route(@Param("id", ParseIntPipe) id: number) {
    return this.requests.route(id);
  }

  @Patch(":id/complete")
  complete(@Param("id", ParseIntPipe) id: number) {
    return this.requests.complete(id);
  }
}
