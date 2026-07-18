import { Module } from "@nestjs/common";
import { ServiceRequestsService } from "./service-requests.service";
import { ServiceRequestsController } from "./service-requests.controller";
import { SkillsModule } from "../skills/skills.module";
import { RoutingModule } from "../routing/routing.module";

@Module({
  imports: [SkillsModule, RoutingModule],
  providers: [ServiceRequestsService],
  controllers: [ServiceRequestsController],
  exports: [ServiceRequestsService],
})
export class ServiceRequestsModule {}
