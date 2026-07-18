import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "../src/app.module";
import { patchSwaggerForZod } from "../src/common/swagger-zod";

async function main() {
  patchSwaggerForZod();
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle("Skill-Based Routing API")
    .setDescription(
      "Matches service requests to qualified, available technicians by skill, level, availability, and workload.",
    )
    .setVersion("1.0")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const out = join(__dirname, "..", "openapi.json");
  writeFileSync(out, JSON.stringify(document, null, 2));
  await app.close();
  console.log(`Wrote ${out}`);
}

void main();
