import { forwardRef, Module } from "@nestjs/common";
import { RoutingService } from "./routing.service";
import { TechniciansModule } from "../technicians/technicians.module";

@Module({
  imports: [forwardRef(() => TechniciansModule)],
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
