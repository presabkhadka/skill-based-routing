import { forwardRef, Module } from "@nestjs/common";
import { TechniciansService } from "./technicians.service";
import { TechniciansController } from "./technicians.controller";
import { SkillsModule } from "../skills/skills.module";
import { RoutingModule } from "../routing/routing.module";

@Module({
  imports: [SkillsModule, forwardRef(() => RoutingModule)],
  providers: [TechniciansService],
  controllers: [TechniciansController],
  exports: [TechniciansService],
})
export class TechniciansModule {}
