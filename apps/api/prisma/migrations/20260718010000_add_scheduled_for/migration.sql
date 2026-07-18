-- Optional scheduled service time; the working-hours gate is checked against it.
ALTER TABLE "ServiceRequest" ADD COLUMN "scheduledFor" TIMESTAMP(3);
