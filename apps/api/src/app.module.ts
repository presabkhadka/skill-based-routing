import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { PrismaModule } from "./prisma/prisma.module";
import { SkillsModule } from "./skills/skills.module";
import { TechniciansModule } from "./technicians/technicians.module";
import { RoutingModule } from "./routing/routing.module";
import { ServiceRequestsModule } from "./service-requests/service-requests.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SkillsModule,
    TechniciansModule,
    RoutingModule,
    ServiceRequestsModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {}
