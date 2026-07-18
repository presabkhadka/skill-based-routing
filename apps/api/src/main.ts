import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { patchSwaggerForZod } from "./common/swagger-zod";

patchSwaggerForZod();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? "*",
  });

  const config = new DocumentBuilder()
    .setTitle("Skill-Based Routing API")
    .setDescription(
      "Matches service requests to qualified, available technicians by skill, level, availability, and workload.",
    )
    .setVersion("1.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port} (docs at /docs)`);
}

void bootstrap();
